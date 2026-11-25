"""Whasalia voice service: WhatsApp calls answered by an AI agent.

Whasalia (the Next.js app) owns the call: the WhatsApp number, Meta's
Calling API, the agent's prompt and tools, billing. This service only
carries the audio between WhatsApp's WebRTC and OpenAI Realtime, with
Pipecat (https://docs.pipecat.ai/pipecat/features/whatsapp).

  POST   /calls        {call, sdp, api_key, model, voice, language, instructions,
                        greeting, tools, max_seconds, callback_url} -> {sdp}
                       Answers WhatsApp's WebRTC offer and starts the bot.
                       Whasalia then sends pre_accept + accept to Meta.
  DELETE /calls/{id}   Stop it (the call ended on WhatsApp's side).
  GET    /health

Callbacks to Whasalia (same bearer secret):
  POST {callback_url}/tool  {name, arguments} -> {result}
  POST {callback_url}/end   {transcript, hangup, reason}

Every request carries `Authorization: Bearer VOICE_SERVICE_SECRET`.
"""

from __future__ import annotations

import asyncio
import hmac
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, Request
from loguru import logger
from pipecat.adapters.llm.schemas.function_schema import FunctionSchema
from pipecat.adapters.llm.schemas.tools_schema import ToolsSchema
from pipecat.frames.frames import LLMMessagesAppendFrame, LLMRunFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker, ProcessorUnusablePolicy
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    AssistantTurnStoppedMessage,
    LLMContextAggregatorPair,
    UserTurnMessageAddedMessage,
)
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.realtime.events import (
    AudioConfiguration,
    AudioInput,
    AudioOutput,
    InputAudioNoiseReduction,
    InputAudioTranscription,
    SemanticTurnDetection,
    SessionProperties,
)
from pipecat.services.openai.realtime.llm import OpenAIRealtimeLLMService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

SECRET = os.environ.get("VOICE_SERVICE_SECRET", "").strip()
MAX_CALLS = int(os.environ.get("MAX_CALLS", "20"))
# Seconds to wait for WhatsApp's audio to connect before giving up.
CONNECT_TIMEOUT = float(os.environ.get("CONNECT_TIMEOUT_SECS", "20"))
# Seconds left when the AI is asked to wrap up before the time limit.
WRAP_UP_SECS = 25
# Time for the goodbye to finish playing before hanging up.
GOODBYE_SECS = 4.0


def ice_servers() -> list[IceServer]:
    """STUN by default; a TURN server if the host blocks direct UDP."""
    servers = [IceServer(urls=os.environ.get("STUN_URL", "stun:stun.l.google.com:19302"))]
    if os.environ.get("TURN_URL"):
        servers.append(
            IceServer(
                urls=os.environ["TURN_URL"],
                username=os.environ.get("TURN_USERNAME"),
                credential=os.environ.get("TURN_PASSWORD"),
            )
        )
    return servers


def authorized(request: Request) -> bool:
    header = request.headers.get("authorization", "")
    if len(SECRET) < 24 or not header.startswith("Bearer "):
        return False
    return hmac.compare_digest(header[7:].strip().encode(), SECRET.encode())


def whatsapp_sdp(sdp: str) -> str:
    """WhatsApp only takes SHA-256 DTLS fingerprints (same filter as Pipecat's WhatsApp client)."""
    lines = [
        line
        for line in sdp.splitlines()
        if not (line.startswith("a=fingerprint:") and not line.startswith("a=fingerprint:sha-256"))
    ]
    return "\r\n".join(lines) + "\r\n"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Call:
    id: str
    callback_url: str
    connection: SmallWebRTCConnection
    transcript: list[dict[str, Any]] = field(default_factory=list)
    runner: WorkerRunner | None = None
    worker: PipelineWorker | None = None
    connected: bool = False
    finished: bool = False
    # Watchdog and delayed hang-up; cancelled when the call ends.
    tasks: list[asyncio.Task] = field(default_factory=list)
    bot: asyncio.Task | None = None


calls: dict[str, Call] = {}
http = httpx.AsyncClient(timeout=httpx.Timeout(20.0))
app = FastAPI(title="Whasalia voice", docs_url=None, redoc_url=None)


async def callback(call: Call, path: str, payload: dict[str, Any]) -> dict[str, Any]:
    res = await http.post(
        f"{call.callback_url}/{path}",
        json=payload,
        headers={"Authorization": f"Bearer {SECRET}"},
    )
    res.raise_for_status()
    return res.json()


async def finish(call: Call, *, hangup: bool, reason: str) -> None:
    """Ends the bot once, then hands the transcript to Whasalia (and asks it to hang up)."""
    if call.finished:
        return
    call.finished = True
    calls.pop(call.id, None)
    for task in call.tasks:
        if task is not asyncio.current_task():
            task.cancel()
    logger.info(f"[{call.id}] finished ({reason}), hangup={hangup}, {len(call.transcript)} lines")
    try:
        if call.runner:
            await call.runner.cancel()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[{call.id}] cancel failed: {e}")
    try:
        await call.connection.disconnect()
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[{call.id}] disconnect failed: {e}")
    for attempt in range(3):
        try:
            await callback(call, "end", {"transcript": call.transcript, "hangup": hangup, "reason": reason})
            return
        except Exception as e:  # noqa: BLE001
            logger.warning(f"[{call.id}] end callback failed ({attempt + 1}/3): {e}")
            await asyncio.sleep(1 + attempt * 2)


def tool_schemas(call: Call, tools: list[dict[str, Any]]) -> list[FunctionSchema]:
    """Whasalia's tools. end_call runs here; the rest run in Whasalia."""

    def make_handler(name: str):
        async def handler(params: FunctionCallParams) -> None:
            if name == "end_call":
                await params.result_callback({"ok": True})

                async def hang_up_later():
                    await asyncio.sleep(GOODBYE_SECS)
                    await finish(call, hangup=True, reason="ai_ended")

                call.tasks.append(asyncio.create_task(hang_up_later()))
                return
            try:
                data = await callback(call, "tool", {"name": name, "arguments": params.arguments or {}})
                await params.result_callback(data.get("result", {}))
            except Exception as e:  # noqa: BLE001
                logger.warning(f"[{call.id}] tool {name} failed: {e}")
                await params.result_callback(
                    {"error": "The system is not available right now. Apologize and offer that the team gets back to the caller."}
                )

        return handler

    out: list[FunctionSchema] = []
    for t in tools:
        params = t.get("parameters") or {}
        out.append(
            FunctionSchema(
                name=t["name"],
                description=t.get("description", ""),
                properties=params.get("properties", {}),
                required=params.get("required", []),
                handler=make_handler(t["name"]),
            )
        )
    return out


async def run_bot(call: Call, cfg: dict[str, Any]) -> None:
    transport = SmallWebRTCTransport(
        webrtc_connection=call.connection,
        params=TransportParams(audio_in_enabled=True, audio_out_enabled=True),
    )
    language = cfg.get("language") if cfg.get("language") in ("es", "en") else None
    llm = OpenAIRealtimeLLMService(
        api_key=cfg["api_key"],
        settings=OpenAIRealtimeLLMService.Settings(
            model=cfg.get("model") or "gpt-realtime-2.1",
            system_instruction=cfg["instructions"],
            session_properties=SessionProperties(
                audio=AudioConfiguration(
                    input=AudioInput(
                        transcription=InputAudioTranscription(language=language),
                        turn_detection=SemanticTurnDetection(),
                        noise_reduction=InputAudioNoiseReduction(type="near_field"),
                    ),
                    output=AudioOutput(voice=cfg.get("voice") or "marin"),
                )
            ),
        ),
    )
    greeting = str(cfg.get("greeting") or "").strip()
    context = LLMContext(
        [{"role": "developer", "content": f'The call just connected. Greet the caller now by saying exactly: "{greeting}"'}],
        ToolsSchema(standard_tools=tool_schemas(call, cfg.get("tools") or [])),
    )
    user_aggregator, assistant_aggregator = LLMContextAggregatorPair(context)
    pipeline = Pipeline([transport.input(), user_aggregator, llm, transport.output(), assistant_aggregator])
    worker = PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=False, enable_usage_metrics=True),
        # WhatsApp has no data channel for RTVI messages.
        enable_rtvi=False,
        idle_timeout_secs=120,
        # OpenAI refused (bad key, no credit…): end the call instead of leaving it silent.
        processor_unusable_policy=ProcessorUnusablePolicy.END,
    )
    runner = WorkerRunner(handle_sigint=False)
    call.worker, call.runner = worker, runner
    await runner.add_workers(worker)

    @llm.event_handler("on_error")
    async def on_llm_error(_llm, error):
        # OpenAI refused the session (bad key, no credit, unknown model…):
        # hang up instead of leaving the caller in silence.
        if not call.finished and not any(t.get_name() == "ai_error" for t in call.tasks):
            logger.error(f"[{call.id}] OpenAI error, ending the call: {error}")
            call.tasks.append(asyncio.create_task(finish(call, hangup=True, reason="ai_error"), name="ai_error"))

    @transport.event_handler("on_client_connected")
    async def on_connected(_transport, _client):
        call.connected = True
        logger.info(f"[{call.id}] audio connected")
        await worker.queue_frames([LLMRunFrame()])

    @transport.event_handler("on_client_disconnected")
    async def on_disconnected(_transport, _client):
        await finish(call, hangup=False, reason="caller_left")

    @user_aggregator.event_handler("on_user_turn_message_added")
    async def on_user(_aggregator, message: UserTurnMessageAddedMessage):
        if message.content:
            call.transcript.append({"role": "user", "text": str(message.content), "at": now_iso()})

    @assistant_aggregator.event_handler("on_assistant_turn_stopped")
    async def on_assistant(_aggregator, message: AssistantTurnStoppedMessage):
        if message.content:
            call.transcript.append({"role": "assistant", "text": str(message.content), "at": now_iso()})

    max_seconds = max(60, int(cfg.get("max_seconds") or 600))

    async def watchdog():
        await asyncio.sleep(CONNECT_TIMEOUT)
        if not call.connected:
            await finish(call, hangup=True, reason="no_media")
            return
        await asyncio.sleep(max(0, max_seconds - CONNECT_TIMEOUT - WRAP_UP_SECS))
        await worker.queue_frames(
            [
                LLMMessagesAppendFrame(
                    [{"role": "developer", "content": "The call time is almost up. Say a brief goodbye now and call end_call."}],
                    run_llm=True,
                )
            ]
        )
        await asyncio.sleep(WRAP_UP_SECS)
        await finish(call, hangup=True, reason="time_limit")

    call.tasks.append(asyncio.create_task(watchdog()))
    try:
        await runner.run()
    except Exception as e:  # noqa: BLE001
        logger.exception(f"[{call.id}] bot crashed: {e}")
    finally:
        await finish(call, hangup=True, reason="bot_stopped")


@app.get("/health")
async def health():
    return {"ok": True, "calls": len(calls)}


@app.post("/calls")
async def start_call(request: Request):
    if not authorized(request):
        raise HTTPException(status_code=401, detail="Unauthorized")
    try:
        cfg = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON")
    for key in ("call", "sdp", "api_key", "instructions", "callback_url"):
        if not isinstance(cfg.get(key), str) or not cfg[key]:
            raise HTTPException(status_code=400, detail=f"{key} is required")
    if cfg["call"] in calls:
        raise HTTPException(status_code=409, detail="Call already running")
    if len(calls) >= MAX_CALLS:
        raise HTTPException(status_code=503, detail="Too many calls")

    connection = SmallWebRTCConnection(ice_servers())
    try:
        await connection.initialize(sdp=cfg["sdp"], type="offer")
        answer = connection.get_answer()
        if not answer or not answer.get("sdp"):
            raise RuntimeError("no SDP answer")
    except Exception as e:  # noqa: BLE001
        logger.warning(f"[{cfg['call']}] WebRTC setup failed: {e}")
        try:
            await connection.disconnect()
        except Exception:  # noqa: BLE001
            pass
        raise HTTPException(status_code=502, detail="WebRTC setup failed")

    call = Call(id=cfg["call"], callback_url=cfg["callback_url"].rstrip("/"), connection=connection)
    calls[call.id] = call
    call.bot = asyncio.create_task(run_bot(call, cfg))
    logger.info(f"[{call.id}] answering")
    return {"sdp": whatsapp_sdp(answer["sdp"])}


@app.delete("/calls/{call_id}")
async def stop_call(call_id: str, request: Request):
    if not authorized(request):
        raise HTTPException(status_code=401, detail="Unauthorized")
    call = calls.get(call_id)
    if call:
        await finish(call, hangup=False, reason="ended_on_whatsapp")
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn

    if len(SECRET) < 24:
        raise SystemExit("VOICE_SERVICE_SECRET must be set (24+ characters)")
    import socket

    # One dual-stack socket: IPv4 and IPv6 (Railway's private network may be IPv6 only).
    sock = socket.socket(socket.AF_INET6, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
    sock.bind(("::", int(os.environ.get("PORT", "8000"))))
    uvicorn.Server(uvicorn.Config(app, log_level="info")).run(sockets=[sock])
