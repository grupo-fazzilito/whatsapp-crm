"use client";

import type { Translator } from "@/i18n/translate";

export type AssistResult<T> = { ok: true; data: T } | { ok: false; code: string };

/** POST/GET to /api/ai-assist/…; errors come back as a stable `code`. */
export async function assistFetch<T>(path: string, init?: { method?: "GET" | "POST" | "PATCH"; body?: unknown }): Promise<AssistResult<T>> {
  try {
    const res = await fetch(`/api/ai-assist/${path}`, {
      method: init?.method ?? "POST",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 429) return { ok: false, code: "rate_limited" };
    if (!res.ok) return { ok: false, code: typeof json?.code === "string" ? json.code : "failed" };
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, code: "failed" };
  }
}

/** User-facing message for an error code. `kind` picks the provider hint. */
export function assistErrorText(t: Translator, code: string, kind: "audio" | "vision" | "text"): string {
  switch (code) {
    case "no_provider":
      return kind === "audio" ? t("aiassist.errors.noAudioProvider") : t("aiassist.errors.noVisionProvider");
    case "no_text_provider":
      return t("aiassist.errors.noTextProvider");
    case "too_large":
      return t("aiassist.errors.tooLarge");
    case "unsupported_type":
    case "not_media":
      return t("aiassist.errors.unsupported");
    case "media_unavailable":
      return t("aiassist.errors.mediaUnavailable");
    case "empty":
      return t("aiassist.errors.empty");
    case "rate_limited":
      return t("aiassist.errors.rateLimited");
    default:
      return t("aiassist.errors.failed");
  }
}
