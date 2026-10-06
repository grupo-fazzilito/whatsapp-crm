export const CHANNEL_TYPES = ['whatsapp', 'messenger', 'instagram', 'tiktok', 'webchat'] as const
export type ChannelType = (typeof CHANNEL_TYPES)[number]

export interface ChannelRow {
  id: string
  workspace_id: string
  type: ChannelType
  name: string
  purpose: string | null
  external_id: string
  display_handle: string | null
  status: 'connected' | 'disconnected' | 'error'
  status_detail: string | null
  settings: Record<string, unknown>
  ai_agent_id: string | null
  created_at: string
  updated_at: string
}

/** Decrypted credentials; which keys exist depends on the channel type. */
export interface ChannelSecrets {
  access_token?: string
  verify_token?: string
  [key: string]: string | undefined
}

export interface LoadedChannel extends ChannelRow {
  secrets: ChannelSecrets
}

export interface ChannelCapabilities {
  /** Pre-approved templates (WhatsApp only). */
  templates: boolean
  reactions: boolean
  /** Native buttons / lists; otherwise sent as a numbered text menu. */
  interactive: boolean
  /** Free-form replies only within N hours of the customer's last message. */
  replyWindowHours: number | null
  media: boolean
}

export interface InteractiveOption {
  id: string
  title: string
  description?: string
}

/** What to send, independent of the channel. */
export type OutboundContent =
  | { type: 'text'; text: string }
  | { type: 'media'; mediaType: 'image' | 'video' | 'audio' | 'document'; url: string; caption?: string; filename?: string }
  | { type: 'buttons'; text: string; options: InteractiveOption[]; header?: string; footer?: string }
  | {
      type: 'list'
      text: string
      buttonLabel: string
      sections: { title?: string; options: InteractiveOption[] }[]
      header?: string
      footer?: string
    }
  | {
      type: 'template'
      templateName: string
      language?: string
      params?: string[]
      components?: unknown[]
    }

export interface SendContext {
  channel: LoadedChannel
  /** Provider id of the recipient on this channel (phone, PSID, IGSID...). */
  recipient: string
  /** Provider message id being replied to (quote), when supported. */
  replyToExternalId?: string | null
}

export interface SendResult {
  /** Provider message id; null for channels without one (web chat). */
  externalId: string | null
  /** Recipient id actually used (WhatsApp may rewrite the phone). */
  recipient?: string
}

/** Channel-agnostic inbound event produced by an adapter's parser. */
export type InboundEvent =
  | {
      kind: 'message'
      channelExternalId: string
      from: { externalId: string; name?: string | null; handle?: string | null; phone?: string | null }
      externalMessageId: string
      timestamp: number
      contentType: 'text' | 'image' | 'video' | 'audio' | 'document' | 'location' | 'sticker' | 'interactive'
      text: string | null
      mediaUrl?: string | null
      /** Id of the tapped button / list row / quick reply. */
      interactiveReplyId?: string | null
      replyToExternalId?: string | null
    }
  | {
      kind: 'status'
      channelExternalId: string
      externalMessageId: string
      status: 'sent' | 'delivered' | 'read' | 'failed'
      timestamp: number
      error?: string | null
    }
  | {
      kind: 'reaction'
      channelExternalId: string
      from: { externalId: string }
      targetExternalId: string
      emoji: string | null
      timestamp: number
    }

export interface ChannelAdapter {
  type: ChannelType
  capabilities: ChannelCapabilities
  send(ctx: SendContext, content: OutboundContent): Promise<SendResult>
  sendReaction?(ctx: SendContext, targetExternalId: string, emoji: string): Promise<void>
}

export class ChannelSendError extends Error {
  constructor(
    message: string,
    readonly code: 'not_configured' | 'window_closed' | 'unsupported' | 'provider_error',
  ) {
    super(message)
    this.name = 'ChannelSendError'
  }
}
