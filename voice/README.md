# Whasalia voice service

WhatsApp calls answered by an AI agent. Whasalia (the Next.js app) keeps the
call: Meta's Calling API, the agent's prompt and tools, transcripts and
billing (`src/lib/calls/ai.ts`). This service only carries the audio between
WhatsApp's WebRTC and OpenAI Realtime, with [Pipecat](https://docs.pipecat.ai/pipecat/features/whatsapp).

```
customer calls ─► Meta webhook ─► Whasalia: who answers? (channels.settings.calling.ai)
                                     └─ AI ─► POST voice/calls {offer, prompt, tools}
                                               ◄─ {sdp answer} ─► Meta pre_accept + accept
                     audio: WhatsApp ⇄ voice (aiortc) ⇄ OpenAI Realtime (WebSocket)
                     tools:  voice ─► POST app/api/voice/calls/{id}/tool
                     end:    voice ─► POST app/api/voice/calls/{id}/end {transcript, hangup}
```

## Environment

| Variable | |
|---|---|
| `VOICE_SERVICE_SECRET` | Required, 24+ characters. Same value in the app. |
| `PORT` | Default 8000. |
| `MAX_CALLS` | Simultaneous calls, default 20. |
| `STUN_URL` | Default `stun:stun.l.google.com:19302`. |
| `TURN_URL`, `TURN_USERNAME`, `TURN_PASSWORD` | Only if the host blocks direct UDP media. |

In the app: `VOICE_SERVICE_URL`, `VOICE_SERVICE_SECRET`, `VOICE_CALLBACK_URL`
(optional `OPENAI_REALTIME_API_KEY`, `OPENAI_REALTIME_MODEL`).

## Run locally

```bash
docker build -t whasalia-voice voice
docker run --rm -p 8000:8000 -e VOICE_SERVICE_SECRET=... whasalia-voice
```
