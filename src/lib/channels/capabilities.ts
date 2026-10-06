// Client-safe channel capability data. The adapters (server code that
// imports the Meta API helpers) carry the same values; the browser imports
// this file instead so it never pulls server modules into the bundle.
import type { ChannelCapabilities, ChannelType } from './types'

export const CHANNEL_CAPABILITIES: Record<ChannelType, ChannelCapabilities> = {
  whatsapp: { templates: true, reactions: true, interactive: true, replyWindowHours: 24, media: true },
  messenger: { templates: false, reactions: false, interactive: true, replyWindowHours: 24, media: true },
  instagram: { templates: false, reactions: true, interactive: true, replyWindowHours: 24, media: true },
  tiktok: { templates: false, reactions: false, interactive: false, replyWindowHours: 48, media: false },
  webchat: { templates: false, reactions: false, interactive: true, replyWindowHours: null, media: true },
}

export function channelCapabilities(type: ChannelType | null | undefined): ChannelCapabilities {
  return CHANNEL_CAPABILITIES[type ?? 'whatsapp'] ?? CHANNEL_CAPABILITIES.whatsapp
}

/** Brand name of each channel type (not translated). */
export const CHANNEL_TYPE_LABELS: Record<ChannelType, string> = {
  whatsapp: 'WhatsApp',
  messenger: 'Messenger',
  instagram: 'Instagram',
  tiktok: 'TikTok',
  webchat: 'Web chat',
}

/** Attachment limits shared by the composer and the storage bucket. */
export const ATTACHMENT_MAX_BYTES = 16 * 1024 * 1024
export const ATTACHMENT_ACCEPT = 'image/*,video/*,audio/*,application/pdf'

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document'

export function attachmentKind(mime: string): AttachmentKind | null {
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  if (mime === 'application/pdf') return 'document'
  return null
}
