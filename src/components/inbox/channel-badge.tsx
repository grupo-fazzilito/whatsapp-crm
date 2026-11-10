"use client";

import { cn } from "@/lib/utils";
import type { ChannelType } from "@/lib/channels/types";
import { CHANNEL_TYPE_LABELS } from "@/lib/channels/capabilities";
import { useT } from "@/i18n/client";

/** Minimal channel info the inbox needs (subset of the channels row). */
export interface InboxChannel {
  id: string;
  type: ChannelType;
  name: string;
  purpose: string | null;
  display_handle: string | null;
  status: "connected" | "disconnected" | "error";
  ai_agent_id: string | null;
  /** Stand-in for a deleted channel (the account is no longer connected). */
  removed?: boolean;
}

/**
 * The conversation's channel. When it was deleted, a stand-in built from the
 * origin the conversation keeps (network + account name), marked removed;
 * null only when even the network is unknown.
 */
export function conversationChannel(
  conv: { channel_id?: string | null; channel_type?: string | null; channel_name?: string | null } | null | undefined,
  byId: Map<string, InboxChannel>,
): InboxChannel | null {
  if (!conv) return null;
  const live = conv.channel_id ? byId.get(conv.channel_id) : undefined;
  if (live) return live;
  const type = conv.channel_type as ChannelType | null | undefined;
  if (!type || !(type in CHANNEL_TYPE_LABELS)) return null;
  return {
    id: "",
    type,
    name: conv.channel_name ?? CHANNEL_TYPE_LABELS[type],
    purpose: null,
    display_handle: null,
    status: "disconnected",
    ai_agent_id: null,
    removed: true,
  };
}

const BADGE_BG: Record<ChannelType, string> = {
  whatsapp: "bg-[#25D366] text-white",
  instagram:
    "bg-[linear-gradient(45deg,#F58529_0%,#DD2A7B_50%,#8134AF_80%,#515BD4_100%)] text-white",
  messenger: "bg-[#0084FF] text-white",
  tiktok: "bg-black text-white ring-1 ring-white/30",
  telegram: "bg-[#229ED9] text-white",
  webchat: "bg-slate-500 text-white",
};

/** Simplified, single-colour glyph per channel (no brand assets shipped). */
function Glyph({ type, className }: { type: ChannelType; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    className,
    "aria-hidden": true,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (type) {
    case "whatsapp":
      return (
        <svg {...common}>
          <path d="M3.5 20.5l1.3-4.2A8.5 8.5 0 1 1 8 19.4z" />
          <path d="M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8a5 5 0 0 1-2.8-2.8l.8-1-1-2z" fill="currentColor" strokeWidth={0.5} />
        </svg>
      );
    case "instagram":
      return (
        <svg {...common}>
          <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.3" cy="6.7" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      );
    case "messenger":
      return (
        <svg {...common}>
          <path d="M12 3C7 3 3 6.7 3 11.3c0 2.6 1.3 4.9 3.3 6.4V21l3-1.7c.9.3 1.8.4 2.7.4 5 0 9-3.7 9-8.3S17 3 12 3z" />
          <path d="M7.5 13.5l3-3.2 2 2 3.5-2.8-3 3.3-2-2z" fill="currentColor" strokeWidth={1} />
        </svg>
      );
    case "tiktok":
      return (
        <svg {...common}>
          <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
          <path d="M14 3c.4 2.6 2.2 4.4 5 4.6" />
        </svg>
      );
    case "telegram":
      return (
        <svg {...common}>
          <path d="M21 4L3 11l6 2.5M21 4l-3 16-6.5-5.5M21 4L9 13.5v5l2.5-3.5" />
        </svg>
      );
    case "webchat":
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17M12 3.5c2.3 2.4 3.4 5.2 3.4 8.5s-1.1 6.1-3.4 8.5c-2.3-2.4-3.4-5.2-3.4-8.5S9.7 5.9 12 3.5z" />
        </svg>
      );
  }
}

/** Round, brand-coloured channel icon. `size` in px (default 16). */
export function ChannelIcon({
  type,
  size = 16,
  className,
}: {
  /** null = unknown network (neutral icon). */
  type: ChannelType | null;
  size?: number;
  className?: string;
}) {
  if (!type) {
    return (
      <span
        className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-slate-500 text-[9px] font-bold text-white", className)}
        style={{ width: size, height: size }}
        aria-hidden
      >
        ?
      </span>
    );
  }
  return (
    <span
      title={CHANNEL_TYPE_LABELS[type]}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full",
        BADGE_BG[type],
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Glyph type={type} className="h-[65%] w-[65%]" />
    </span>
  );
}

/** "WhatsApp · Soporte" — channel brand plus its purpose (or name). */
export function channelLine(
  channel: InboxChannel | null | undefined,
  labels?: { unknown: string; removed: string },
): string {
  if (!channel) return labels?.unknown ?? "";
  const brand = CHANNEL_TYPE_LABELS[channel.type];
  const detail = channel.purpose?.trim() || channel.name?.trim();
  const line = detail && detail !== brand ? `${brand} · ${detail}` : brand;
  return channel.removed && labels ? `${line} · ${labels.removed}` : line;
}

/** Labels channelLine needs for unknown / removed channels, in the UI language. */
export function useChannelLineLabels() {
  const t = useT();
  return { unknown: t("inbox.channel.unknown"), removed: t("inbox.channel.removed") };
}

/** Icon + "WhatsApp · Soporte" label. */
export function ChannelBadge({
  channel,
  className,
}: {
  channel: InboxChannel | null | undefined;
  className?: string;
}) {
  const labels = useChannelLineLabels();
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <ChannelIcon type={channel?.type ?? null} size={14} />
      <span className={cn("truncate", channel?.removed && "text-amber-700 dark:text-amber-400")}>{channelLine(channel, labels)}</span>
    </span>
  );
}
