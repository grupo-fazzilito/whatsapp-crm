"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { es as esLocale, enUS } from "date-fns/locale";
import { Download, ExternalLink, FileText, Film, ImageIcon, Music, Loader2, Paperclip } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useI18n } from "@/i18n/client";
import type { Message, Profile } from "@/types";
import { attachmentPath, useMediaSrc } from "./message-bubble";
import type { InboxAgent } from "./use-inbox-directory";

const MEDIA_TYPES = ["image", "video", "audio", "document", "sticker"] as const;
type MediaType = (typeof MEDIA_TYPES)[number];

const TYPE_ICON: Record<MediaType, typeof FileText> = {
  image: ImageIcon,
  sticker: ImageIcon,
  video: Film,
  audio: Music,
  document: FileText,
};

type FileRow = Pick<
  Message,
  "id" | "sender_type" | "sender_id" | "ai_agent_id" | "content_type" | "content_text" | "media_url" | "created_at"
>;

interface ConversationFilesProps {
  conversationId: string;
  contactName: string;
  membersByUserId: Map<string, Profile>;
  agentsById: Map<string, InboxAgent>;
  /** Changes when the thread gets new messages (refetch). */
  refreshKey: number;
}

/** "Archivos" panel: every media/document message of the conversation. */
export function ConversationFiles({ conversationId, contactName, membersByUserId, agentsById, refreshKey }: ConversationFilesProps) {
  const { t, locale } = useI18n();
  const [rows, setRows] = useState<FileRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    createClient()
      .from("messages")
      .select("id, sender_type, sender_id, ai_agent_id, content_type, content_text, media_url, created_at")
      .eq("conversation_id", conversationId)
      .eq("is_internal", false)
      .in("content_type", [...MEDIA_TYPES])
      .not("media_url", "is", null)
      .neq("status", "failed")
      .order("created_at", { ascending: false })
      .limit(300)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Failed to fetch files:", error.message);
        setRows((data as FileRow[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, refreshKey]);

  if (rows === null) {
    return (
      <div className="flex flex-1 items-center justify-center py-12" role="status">
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden="true" />
        <span className="sr-only">{t("inboxpro.files.loading")}</span>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-12 text-center">
        <Paperclip className="h-8 w-8 text-slate-600" aria-hidden="true" />
        <p className="text-sm text-slate-400">{t("inboxpro.files.empty")}</p>
      </div>
    );
  }

  const senderOf = (r: FileRow): string => {
    if (r.sender_type === "customer") return contactName;
    if (r.sender_type === "bot") return r.ai_agent_id ? (agentsById.get(r.ai_agent_id)?.name ?? t("inboxpro.files.from.bot")) : t("inboxpro.files.from.bot");
    const m = r.sender_id ? membersByUserId.get(r.sender_id) : undefined;
    return m?.full_name || m?.email || t("inboxpro.files.from.team");
  };

  return (
    <div className="flex-1 overflow-y-auto px-3 py-3 sm:px-4">
      <h3 className="mb-2 text-xs font-medium text-slate-400">
        {t("inboxpro.files.title")} · {t("inboxpro.files.count", { n: rows.length })}
      </h3>
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <FileItem
            key={r.id}
            row={r}
            sender={senderOf(r)}
            date={format(new Date(r.created_at), locale === "es" ? "d MMM yyyy, HH:mm" : "MMM d, yyyy, HH:mm", {
              locale: locale === "es" ? esLocale : enUS,
            })}
          />
        ))}
      </ul>
    </div>
  );
}

function FileItem({ row, sender, date }: { row: FileRow; sender: string; date: string }) {
  const { t } = useI18n();
  const type = (MEDIA_TYPES as readonly string[]).includes(row.content_type) ? (row.content_type as MediaType) : "document";
  const Icon = TYPE_ICON[type];
  const isImage = type === "image" || type === "sticker";
  const name =
    type === "document" && row.content_text ? row.content_text : row.content_text?.trim() || t(`inboxpro.files.types.${type}`);
  // Images need a renderable src (proxy → blob); bucket objects need a
  // fresh signature. Other proxy/https files open straight from their URL.
  const needsSign = !!row.media_url && !!attachmentPath(row.media_url);
  const resolved = useMediaSrc(isImage || needsSign ? (row.media_url ?? undefined) : undefined);
  const src = isImage || needsSign ? resolved.src : (row.media_url ?? null);
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    const url = row.media_url;
    if (!url) return;
    const path = attachmentPath(url);
    setDownloading(true);
    try {
      let href = src ?? url;
      if (path) {
        const { data } = await createClient()
          .storage.from("attachments")
          .createSignedUrl(path, 600, { download: name });
        if (data?.signedUrl) href = data.signedUrl;
      }
      const a = document.createElement("a");
      a.href = href;
      a.download = name;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } finally {
      setDownloading(false);
    }
  };

  return (
    <li className="flex items-center gap-3 rounded-lg border border-slate-800 bg-slate-900/80 p-2">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-slate-800">
        {isImage && src ? (
          <img src={src} alt={t("inboxpro.files.preview", { name })} className="h-12 w-12 object-cover" loading="lazy" />
        ) : (
          <Icon className="h-5 w-5 text-slate-400" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-100" title={name}>
          {name}
        </p>
        <p className="truncate text-[11px] text-slate-400">
          <span className="sr-only">{t(`inboxpro.files.types.${type}`)} · </span>
          {sender} · {date}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <a
          href={src ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-disabled={!src}
          aria-label={`${t("inboxpro.files.open")}: ${name}`}
          title={t("inboxpro.files.open")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary aria-disabled:pointer-events-none aria-disabled:opacity-40"
        >
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </a>
        <button
          type="button"
          onClick={() => void download()}
          disabled={downloading || !row.media_url}
          aria-label={`${t("inboxpro.files.download")}: ${name}`}
          title={t("inboxpro.files.download")}
          className="flex h-8 w-8 items-center justify-center rounded-md text-slate-300 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
        >
          {downloading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
    </li>
  );
}
