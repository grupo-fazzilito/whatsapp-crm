"use client";

import { format } from "date-fns";
import { Lock, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useI18n } from "@/i18n/client";
import { splitMentions } from "@/lib/inbox/mentions";
import type { Message } from "@/types";

interface NoteBubbleProps {
  message: Message;
  authorName: string;
  /** Member names, to highlight "@Name" mentions. */
  memberNames: string[];
}

/** Internal note: yellow sticky-note style, right side (team). */
export function NoteBubble({ message, authorName, memberNames }: NoteBubbleProps) {
  const { t } = useI18n();
  const time = format(new Date(message.created_at), "HH:mm");
  const segments = splitMentions(message.content_text ?? "", memberNames);
  const failed = message.status === "failed";
  return (
    <div className="flex justify-end">
      <div
        className={cn(
          "max-w-[85%] rounded-xl rounded-br-sm border border-yellow-300 bg-yellow-100 px-3 py-2 text-yellow-950 shadow-sm sm:max-w-[70%]",
          failed && "ring-2 ring-red-500",
        )}
      >
        <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-yellow-900">
          <Lock className="h-3 w-3 shrink-0" aria-hidden="true" />
          {t("inboxpro.notes.label")}
        </p>
        <p className="whitespace-pre-wrap break-words text-sm">
          {segments.map((s, i) =>
            s.mention ? (
              <mark key={i} className="rounded bg-yellow-300 px-0.5 font-semibold text-yellow-950">
                {s.text}
              </mark>
            ) : (
              <span key={i}>{s.text}</span>
            ),
          )}
        </p>
        <p className="mt-1 flex items-center justify-end gap-1 text-[10px] text-yellow-900">
          <span className="truncate">{authorName}</span>
          <span aria-hidden="true">·</span>
          <span>{time}</span>
          {message.status === "sending" && <Clock className="h-3 w-3" aria-label={t("inboxpro.notes.saving")} />}
          {failed && <XCircle className="h-3 w-3 text-red-700" aria-label={t("inboxpro.notes.failed")} />}
        </p>
      </div>
    </div>
  );
}
