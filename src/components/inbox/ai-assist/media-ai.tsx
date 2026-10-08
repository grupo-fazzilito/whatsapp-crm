"use client";

import { useId, useState } from "react";
import { AudioLines, ChevronDown, ChevronUp, Loader2, RotateCw, ScanText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import type { Message } from "@/types";
import { assistErrorText, assistFetch } from "./api";

/** Messages that get a transcript / "Leer con IA" row under the bubble. */
export function hasMediaAi(message: Message): boolean {
  if (message.is_internal || !message.media_url) return false;
  return message.content_type === "audio" || message.content_type === "image" || message.content_type === "document";
}

/**
 * Under an audio bubble: the transcript (collapsible) or a "Transcribir"
 * button. Under images / documents: "Leer con IA" and its result.
 * Results also arrive by realtime (messages UPDATE) when the inbound
 * pipeline transcribed the voice note automatically.
 */
export function MediaAi({ message, align }: { message: Message; align: "start" | "end" }) {
  const { t } = useI18n();
  const panelId = useId();
  const isAudio = message.content_type === "audio";
  const stored = isAudio ? message.transcript : message.ai_media_text;
  const [local, setLocal] = useState<{ id: string; text: string } | null>(null);
  // A result fetched here wins until the realtime row catches up.
  const text = local?.id === message.id ? local.text : stored ?? null;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (force: boolean) => {
    setBusy(true);
    setError(null);
    const r = await assistFetch<{ transcript?: string; text?: string }>(
      `messages/${message.id}/${isAudio ? "transcribe" : "read"}`,
      { body: force ? { force: true } : {} },
    );
    setBusy(false);
    if (!r.ok) {
      setError(assistErrorText(t, r.code, isAudio ? "audio" : "vision"));
      return;
    }
    setLocal({ id: message.id, text: (isAudio ? r.data.transcript : r.data.text) ?? "" });
    setOpen(true);
  };

  const label = isAudio ? t("aiassist.media.transcript") : t("aiassist.media.readResult");
  const Icon = isAudio ? AudioLines : ScanText;

  return (
    <div className={cn("mt-1 flex max-w-full flex-col gap-1 px-1", align === "end" ? "items-end" : "items-start")}>
      {text !== null ? (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls={panelId}
            className="inline-flex items-center gap-1 rounded text-[11px] font-medium text-slate-300 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {open
              ? isAudio ? t("aiassist.media.hideTranscript") : t("aiassist.media.hideRead")
              : isAudio ? t("aiassist.media.showTranscript") : t("aiassist.media.showRead")}
            {open ? <ChevronUp className="h-3 w-3" aria-hidden="true" /> : <ChevronDown className="h-3 w-3" aria-hidden="true" />}
          </button>
          {open && (
            <div
              id={panelId}
              role="region"
              aria-label={label}
              className="max-w-[min(28rem,100%)] rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-xs text-slate-200"
            >
              <p className="whitespace-pre-wrap break-words">{text || t("aiassist.media.emptyTranscript")}</p>
              <button
                type="button"
                onClick={() => void run(true)}
                disabled={busy}
                className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <RotateCw className="h-3 w-3" aria-hidden="true" />}
                {t("aiassist.media.redo")}
              </button>
            </div>
          )}
        </>
      ) : (
        <button
          type="button"
          onClick={() => void run(false)}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full border border-slate-700 bg-slate-900/80 px-2 py-0.5 text-[11px] font-medium text-slate-200 hover:border-primary/60 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : <Icon className="h-3 w-3" aria-hidden="true" />}
          {busy
            ? isAudio ? t("aiassist.media.transcribing") : t("aiassist.media.reading")
            : isAudio ? t("aiassist.media.transcribe") : t("aiassist.media.read")}
        </button>
      )}
      {error && (
        <p role="alert" className="max-w-[min(28rem,100%)] text-[11px] text-amber-300">
          {error}
        </p>
      )}
    </div>
  );
}
