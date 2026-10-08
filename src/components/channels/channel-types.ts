import { Camera, Globe, MessageCircle, MessagesSquare, Music2, type LucideIcon } from 'lucide-react';
import type { ChannelRow, ChannelType } from '@/lib/channels/types';

/** What GET /api/channels returns per channel (never secrets). */
export type ChannelDTO = ChannelRow;

export interface ChannelFeatures {
  metaOAuth: boolean;
  /** WhatsApp Embedded Signup available (platform Meta app + configuration id). */
  whatsappSignup?: boolean;
  tiktok: boolean;
  platformVerifyToken: boolean;
}

export interface AgentOption {
  id: string;
  name: string;
  enabled: boolean;
}

export const CHANNEL_ORDER: ChannelType[] = ['whatsapp', 'instagram', 'messenger', 'webchat', 'tiktok'];

export const CHANNEL_STYLE: Record<ChannelType, { label: string; icon: LucideIcon; tile: string }> = {
  whatsapp: { label: 'WhatsApp', icon: MessageCircle, tile: 'bg-emerald-500 text-white' },
  instagram: {
    label: 'Instagram',
    icon: Camera,
    tile: 'bg-gradient-to-br from-amber-400 via-pink-500 to-purple-600 text-white',
  },
  messenger: { label: 'Messenger', icon: MessagesSquare, tile: 'bg-gradient-to-br from-sky-500 to-violet-500 text-white' },
  webchat: { label: 'Web chat', icon: Globe, tile: 'bg-slate-700 text-white dark:bg-slate-600' },
  tiktok: { label: 'TikTok', icon: Music2, tile: 'bg-black text-white ring-1 ring-white/10' },
};

export const selectClass =
  'h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';

export async function apiJson<T = Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export function widgetSnippet(origin: string, key: string) {
  return `<script src="${origin}/widget.js" data-key="${key}" async></script>`;
}
