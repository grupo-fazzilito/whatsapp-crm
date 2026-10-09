"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { signFile } from "@/lib/storage/client";
import { storagePathFromUrl } from "@/lib/storage/paths";
import type { Message, MessageReaction } from "@/types";
import {
  Clock,
  Check,
  CheckCheck,
  XCircle,
  FileText,
  MapPin,
  LayoutTemplate,
  ImageOff,
  CornerDownLeft,
  Bot,
  RotateCw,
  Info,
  ArrowRightLeft,
  ShoppingCart,
  Receipt,
  PackageCheck,
  Wallet,
  BadgeCheck,
} from "lucide-react";
import { format } from "date-fns";
import { useI18n } from "@/i18n/client";
import { ReplyQuote } from "./reply-quote";
import { MessageReactions } from "./message-reactions";
import { MediaAi, hasMediaAi } from "./ai-assist/media-ai";

interface MessageBubbleProps {
  message: Message;
  /** Pre-computed quote info for messages that reply to another. */
  reply?: { authorLabel: string; preview: string } | null;
  reactions?: MessageReaction[];
  currentUserId?: string;
  onToggleReaction?: (emoji: string) => void;
  /** Name of the AI agent that wrote a bot message. */
  agentName?: string | null;
  /** Resend a failed text message. */
  onRetry?: () => void;
  /** Customer image the bot took as payment proof. */
  isPaymentProof?: boolean;
}

function StatusIcon({ status }: { status: Message["status"] }) {
  switch (status) {
    case "sending":
      return <Clock className="h-3 w-3 text-slate-400" />;
    case "sent":
      return <Check className="h-3 w-3 text-slate-400" />;
    case "delivered":
      return <CheckCheck className="h-3 w-3 text-slate-400" />;
    case "read":
      return <CheckCheck className="h-3 w-3 text-emerald-400" />;
    case "failed":
      return <XCircle className="h-3 w-3 text-red-400" />;
    default:
      return null;
  }
}

// ── Media URL resolution ────────────────────────────────────────────

/** Media proxied through our API (needs the session cookie). */
function isProxyUrl(url: string): boolean {
  return url.startsWith("/api/whatsapp/media/") || url.startsWith("/api/media/");
}

/** Object path inside the private `attachments` bucket, if `url` points there (new or legacy URL). */
export function attachmentPath(url: string): string | null {
  return storagePathFromUrl(url, "attachments");
}

/**
 * Resolves a stored media_url into something the browser can render:
 *  - proxy URLs → authenticated fetch → blob URL
 *  - signed URLs to our private bucket → freshly re-signed (the one
 *    sent to the provider expires after an hour)
 *  - anything else → as is
 */
export function useMediaSrc(url: string | undefined) {
  const [state, setState] = useState<{ src: string | null; error: boolean; loading: boolean }>({
    src: null,
    error: false,
    loading: !!url,
  });

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    let blobUrl: string | null = null;

    (async () => {
      try {
        if (isProxyUrl(url)) {
          const res = await fetch(url);
          if (!res.ok) throw new Error("Failed to load media");
          const blob = await res.blob();
          blobUrl = URL.createObjectURL(blob);
          if (cancelled) {
            URL.revokeObjectURL(blobUrl);
            return;
          }
          setState({ src: blobUrl, error: false, loading: false });
          return;
        }
        const path = attachmentPath(url);
        if (path) {
          const signed = await signFile("attachments", path, { expiresIn: 3600 });
          if (cancelled) return;
          if (!signed) throw new Error("sign failed");
          setState({ src: signed, error: false, loading: false });
          return;
        }
        if (!cancelled) setState({ src: url, error: false, loading: false });
      } catch {
        if (!cancelled) setState({ src: null, error: true, loading: false });
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [url]);

  return state;
}

function MediaUnavailable({ label }: { label: string }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-2 rounded-lg bg-slate-700/40 px-3 py-2 text-xs text-slate-300">
      <ImageOff className="h-4 w-4 shrink-0 text-slate-500" />
      <span>{t("inbox.bubble.unavailable", { label })}</span>
    </div>
  );
}

function MediaLoading() {
  return (
    <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-slate-700">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}

function MediaError() {
  return (
    <div className="flex h-40 w-60 items-center justify-center rounded-lg bg-slate-700">
      <ImageOff className="h-8 w-8 text-slate-500" />
    </div>
  );
}

function MediaImage({ url, alt }: { url: string; alt: string }) {
  const { src, error, loading } = useMediaSrc(url);
  const [broken, setBroken] = useState(false);
  if (error || broken) return <MediaError />;
  if (loading || !src) return <MediaLoading />;
  return (
    <img
      src={src}
      alt={alt}
      className="max-h-64 max-w-60 rounded-lg object-cover"
      onError={() => setBroken(true)}
    />
  );
}

function MediaVideo({ url }: { url: string }) {
  const { src, error, loading } = useMediaSrc(url);
  if (error) return <MediaError />;
  if (loading || !src) return <MediaLoading />;
  return <video src={src} controls className="max-h-64 max-w-60 rounded-lg" />;
}

function MediaAudio({ url }: { url: string }) {
  const { src, error, loading } = useMediaSrc(url);
  const { t } = useI18n();
  if (error) return <MediaUnavailable label={t("inbox.media.audio")} />;
  if (loading || !src) {
    return <div className="h-10 w-60 animate-pulse rounded-full bg-slate-700/60" />;
  }
  return <audio src={src} controls className="max-w-60" />;
}

function MediaDocument({ url, label }: { url: string; label: string }) {
  // Proxy URLs are same-origin, so a plain link carries the session
  // cookie; only bucket URLs need re-signing.
  const needsSign = !!attachmentPath(url);
  const { src } = useMediaSrc(needsSign ? url : undefined);
  const href = needsSign ? src : url;
  return (
    <a
      href={href ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg bg-slate-700/50 px-3 py-2 text-sm hover:bg-slate-700"
    >
      <FileText className="h-5 w-5 shrink-0 text-slate-400" />
      <span className="truncate">{label}</span>
    </a>
  );
}

// ── Interactive options (bot buttons / lists) ───────────────────────

interface OptionLike {
  id?: string;
  title?: string;
}

function readOptions(metadata: Message["metadata"]): {
  options: OptionLike[];
  sections: { title?: string; options: OptionLike[] }[];
  buttonLabel?: string;
} {
  const meta = (metadata ?? {}) as Record<string, unknown>;
  const options = Array.isArray(meta.options) ? (meta.options as OptionLike[]) : [];
  const sections = Array.isArray(meta.sections)
    ? (meta.sections as { title?: string; options?: OptionLike[] }[]).map((s) => ({
        title: s?.title,
        options: Array.isArray(s?.options) ? s.options : [],
      }))
    : [];
  const buttonLabel = typeof meta.button_label === "string" ? meta.button_label : undefined;
  return { options, sections, buttonLabel };
}

function OptionChips({ options }: { options: OptionLike[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1">
      {options.map((o, i) => (
        <span
          key={o.id ?? i}
          className="rounded-full border border-white/30 bg-black/10 px-2 py-0.5 text-[11px]"
        >
          {o.title}
        </span>
      ))}
    </div>
  );
}

function InteractiveOptions({ message }: { message: Message }) {
  const { options, sections, buttonLabel } = readOptions(message.metadata);
  if (options.length === 0 && sections.length === 0) return null;
  return (
    <div className="mt-1">
      {options.length > 0 && <OptionChips options={options} />}
      {sections.length > 0 && (
        <div className="mt-1 space-y-1">
          {buttonLabel && (
            <p className="text-[10px] font-medium uppercase tracking-wide opacity-70">
              {buttonLabel}
            </p>
          )}
          {sections.map((s, i) => (
            <div key={i}>
              {s.title && <p className="text-[10px] opacity-70">{s.title}</p>}
              <OptionChips options={s.options} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Product carousel (read-only preview of what the customer saw) ──

interface CardLike {
  id?: string;
  imageUrl?: string;
  title?: string;
  subtitle?: string;
  buttons?: OptionLike[];
}

function readCards(metadata: Message["metadata"]): CardLike[] {
  const cards = (metadata as Record<string, unknown> | null | undefined)?.cards;
  return Array.isArray(cards)
    ? (cards as CardLike[]).filter((c) => c && typeof c.title === "string")
    : [];
}

function CardsPreview({ cards }: { cards: CardLike[] }) {
  const { t } = useI18n();
  return (
    <ul
      className="mt-1.5 flex max-w-72 snap-x gap-2 overflow-x-auto pb-1"
      aria-label={t("inbox.bubble.carousel", { count: cards.length })}
    >
      {cards.map((c, i) => (
        <li
          key={c.id ?? i}
          className="w-32 shrink-0 snap-start overflow-hidden rounded-lg bg-black/15"
        >
          {c.imageUrl && /^https?:\/\//.test(c.imageUrl) ? (
            <img
              src={c.imageUrl}
              alt=""
              loading="lazy"
              className="aspect-[4/3] w-full object-cover"
            />
          ) : (
            <div className="flex aspect-[4/3] w-full items-center justify-center bg-black/10">
              <ImageOff className="h-5 w-5 opacity-50" />
            </div>
          )}
          <div className="p-1.5">
            <p className="line-clamp-2 text-xs font-medium">{c.title}</p>
            {c.subtitle && <p className="truncate text-[11px] opacity-80">{c.subtitle}</p>}
            {Array.isArray(c.buttons) && c.buttons.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {c.buttons.map((b, j) => (
                  <span
                    key={b.id ?? j}
                    className="rounded border border-white/30 px-1 py-px text-[10px]"
                  >
                    {b.title}
                  </span>
                ))}
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Commerce events (cart / order / payment) ────────────────────────

const COMMERCE_EVENTS = {
  cart_summary: ShoppingCart,
  order_placed: Receipt,
  order_status: PackageCheck,
  payment_options: Wallet,
  payment_method: Wallet,
  payment_proof: BadgeCheck,
} as const;

type CommerceEvent = keyof typeof COMMERCE_EVENTS;

function commerceEvent(metadata: Message["metadata"]): CommerceEvent | null {
  const ev = (metadata as Record<string, unknown> | null | undefined)?.event;
  return typeof ev === "string" && ev in COMMERCE_EVENTS ? (ev as CommerceEvent) : null;
}

function EventBadge({ event }: { event: CommerceEvent }) {
  const { t } = useI18n();
  const Icon = COMMERCE_EVENTS[event];
  return (
    <span className="mb-1 inline-flex items-center gap-1 rounded bg-black/20 px-1.5 py-0.5 text-[10px] font-medium">
      <Icon className="h-3 w-3" aria-hidden="true" />
      {t(`inbox.bubble.events.${event}`)}
    </span>
  );
}

function MessageContent({ message }: { message: Message }) {
  const { t } = useI18n();
  const isOutbound = message.sender_type !== "customer";

  switch (message.content_type) {
    case "text":
      return (
        <p className="whitespace-pre-wrap break-words text-sm">
          {message.content_text}
        </p>
      );

    case "image":
    case "sticker":
      return (
        <div>
          {message.media_url ? (
            <MediaImage url={message.media_url} alt={t("inbox.media.image")} />
          ) : (
            <MediaUnavailable label={t("inbox.media.image")} />
          )}
          {message.content_text && message.content_type === "image" && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "video":
      return (
        <div>
          {message.media_url ? (
            <MediaVideo url={message.media_url} />
          ) : (
            <MediaUnavailable label={t("inbox.media.video")} />
          )}
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "audio":
      return (
        <div>
          {message.media_url ? (
            <MediaAudio url={message.media_url} />
          ) : (
            <MediaUnavailable label={t("inbox.media.audio")} />
          )}
        </div>
      );

    case "document": {
      const label = message.content_text || t("inbox.media.document");
      if (!message.media_url) return <MediaUnavailable label={label} />;
      return <MediaDocument url={message.media_url} label={label} />;
    }

    case "template":
      return (
        <div>
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-medium text-primary">
            <LayoutTemplate className="h-3 w-3" />
            {t("inbox.bubble.template")}
          </span>
          {message.content_text && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
          )}
        </div>
      );

    case "location":
      return (
        <div className="flex items-center gap-2 text-sm">
          <MapPin className="h-4 w-4 shrink-0 text-slate-400" />
          <span>{message.content_text || t("inbox.bubble.location")}</span>
        </div>
      );

    case "interactive": {
      // Outbound: the bot's buttons / list — show the text and the
      // options as read-only chips. Inbound: the customer tapped one.
      if (isOutbound) {
        const cards = readCards(message.metadata);
        return (
          <div>
            <p className="whitespace-pre-wrap break-words text-sm">
              {message.content_text}
            </p>
            {cards.length > 0 && <CardsPreview cards={cards} />}
            <InteractiveOptions message={message} />
          </div>
        );
      }
      return (
        <div className="flex flex-col gap-0.5">
          <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-slate-400">
            <CornerDownLeft className="h-3 w-3" />
            {t("inbox.bubble.buttonReply")}
          </span>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || t("inbox.bubble.interactiveReply")}
          </p>
        </div>
      );
    }

    default:
      return (
        <div>
          <p className="whitespace-pre-wrap break-words text-sm">
            {message.content_text || t("inbox.bubble.unsupported")}
          </p>
          {isOutbound && <InteractiveOptions message={message} />}
        </div>
      );
  }
}

export function MessageBubble({
  message,
  reply,
  reactions,
  currentUserId,
  onToggleReaction,
  agentName,
  onRetry,
  isPaymentProof,
}: MessageBubbleProps) {
  const { t } = useI18n();
  const time = format(new Date(message.created_at), "HH:mm");

  // System notes (e.g. "conversation handed to the AI") are centred,
  // not attributed to either side.
  if (message.content_type === "system") {
    const event = (message.metadata as Record<string, unknown> | null | undefined)?.event;
    if (event === "agent_transfer") {
      // AI agent → AI agent hand-off: a thin labelled divider.
      return (
        <div className="flex items-center gap-2 py-1" role="separator" aria-label={`${t("routing.inbox.transferred")}: ${message.content_text ?? ""}`}>
          <span className="h-px flex-1 bg-violet-500/25" />
          <span className="inline-flex max-w-[80%] items-center gap-1.5 rounded-full border border-violet-500/30 bg-slate-900/90 px-2.5 py-0.5 text-[11px] text-violet-300">
            <ArrowRightLeft className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {t("routing.inbox.transferred")}: {message.content_text}
            </span>
            <span className="shrink-0 text-[10px] text-slate-500">{time}</span>
          </span>
          <span className="h-px flex-1 bg-violet-500/25" />
        </div>
      );
    }
    return (
      <div className="flex justify-center">
        <span className="inline-flex items-center gap-1 rounded-full bg-slate-800/80 px-3 py-1 text-[11px] text-slate-400">
          <Info className="h-3 w-3" />
          {message.content_text}
        </span>
      </div>
    );
  }

  const isAgent = message.sender_type === "agent" || message.sender_type === "bot";
  const isBot = message.sender_type === "bot";
  const failed = message.status === "failed";
  const meta = (message.metadata ?? {}) as Record<string, unknown>;
  const errorText = typeof meta.error === "string" ? meta.error : null;
  const event = isAgent ? commerceEvent(message.metadata) : null;

  // Row alignment + width cap are owned by <MessageActions> so its hover
  // group matches the bubble's content area, not the full row.
  return (
    <div
      className={cn(
        "flex flex-col",
        isAgent ? "items-end" : "items-start",
      )}
    >
      {isBot && (
        <span className="mb-0.5 inline-flex items-center gap-1 px-1 text-[10px] text-slate-400">
          <Bot className="h-3 w-3" />
          {agentName || t("inbox.bubble.aiAgent")}
        </span>
      )}
      {isAgent && meta.source === "whatsapp_business_app" && (
        <span className="mb-0.5 px-1 text-[10px] text-slate-400">{t("metawa.bubble.fromPhone")}</span>
      )}
      <div
        className={cn(
          "relative rounded-2xl px-3 py-2",
          isAgent
            ? isBot
              ? "rounded-br-md bg-primary/80 text-primary-foreground"
              : "rounded-br-md bg-primary text-primary-foreground"
            : "rounded-bl-md bg-slate-800 text-slate-100",
          failed && "ring-1 ring-red-500/70",
        )}
      >
        {reply && (
          <ReplyQuote authorLabel={reply.authorLabel} preview={reply.preview} />
        )}
        {event && <EventBadge event={event} />}
        {isPaymentProof && (
          <span className="mb-1 inline-flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300">
            <BadgeCheck className="h-3 w-3" aria-hidden="true" />
            {t("inbox.bubble.paymentProof")}
          </span>
        )}
        <MessageContent message={message} />
        <div
          className={cn(
            "mt-1 flex items-center gap-1",
            isAgent ? "justify-end" : "justify-start",
          )}
        >
          <span className="text-[10px] text-white/60">{time}</span>
          {isAgent && <StatusIcon status={message.status} />}
        </div>
      </div>
      {hasMediaAi(message) && <MediaAi message={message} align={isAgent ? "end" : "start"} />}
      {failed && isAgent && (
        <div className="mt-0.5 flex max-w-full items-center gap-2 px-1 text-[10px] text-red-400">
          <span className="truncate" title={errorText ?? undefined}>
            {errorText
              ? t("inbox.bubble.failedWithReason", { reason: errorText })
              : t("inbox.bubble.failed")}
          </span>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex shrink-0 items-center gap-0.5 font-medium text-red-300 underline-offset-2 hover:underline"
            >
              <RotateCw className="h-3 w-3" />
              {t("inbox.bubble.retry")}
            </button>
          )}
        </div>
      )}
      {reactions && reactions.length > 0 && onToggleReaction && (
        <MessageReactions
          reactions={reactions}
          currentUserId={currentUserId}
          onToggle={onToggleReaction}
        />
      )}
    </div>
  );
}
