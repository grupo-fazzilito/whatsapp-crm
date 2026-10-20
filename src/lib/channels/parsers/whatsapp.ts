import { normalizePhone } from '@/lib/whatsapp/phone-utils'
import type { InboundEvent, InboundSender } from '../types'

interface WaMedia {
  id: string
  mime_type?: string
  caption?: string
  filename?: string
}

export interface WaMessage {
  /** Customer's phone; left out when they have a username and haven't shared it with us. */
  from?: string
  /** Business-scoped user id (BSUID), always sent since April 2026. */
  from_user_id?: string
  /** Echoes / history: the customer the business wrote to. */
  to?: string
  id: string
  timestamp: string
  type: string
  text?: { body: string }
  image?: WaMedia
  video?: WaMedia
  document?: WaMedia
  audio?: WaMedia
  sticker?: WaMedia
  location?: { latitude: number; longitude: number; name?: string; address?: string }
  reaction?: { message_id: string; emoji?: string }
  interactive?: {
    type: string
    button_reply?: { id: string; title: string }
    list_reply?: { id: string; title: string }
  }
  button?: { payload?: string; text?: string }
  context?: { id: string }
  /** History sync only: delivery state on the phone (READ, DELIVERED, PLAYED...). */
  history_context?: { status?: string }
  /** type 'system': the customer changed their number or BSUID. `from` is then the old number. */
  system?: { type?: string; wa_id?: string; user_id?: string; previous_user_id?: string }
}

/** Who wrote: `wa_id` (phone) only when Meta can share it; `user_id` (BSUID) always. */
export interface WaContact {
  profile?: { name?: string; username?: string }
  wa_id?: string
  user_id?: string
}

export interface WaHistoryChunk {
  metadata?: { phase?: number; chunk_order?: number; progress?: number }
  threads?: { id: string; messages?: WaMessage[] }[]
  errors?: { code?: number; title?: string; message?: string }[]
}

export interface WaStateSyncItem {
  type?: string
  contact?: { full_name?: string; first_name?: string; phone_number?: string }
  action?: string
  metadata?: { timestamp?: string }
}

export interface WaWebhookBody {
  object?: string
  entry?: {
    id: string
    changes?: {
      field: string
      value: {
        metadata?: { phone_number_id: string; display_phone_number?: string }
        contacts?: WaContact[]
        messages?: WaMessage[]
        message_echoes?: WaMessage[]
        history?: WaHistoryChunk[]
        state_sync?: WaStateSyncItem[]
        statuses?: { id: string; status: string; timestamp: string; errors?: { title?: string; message?: string }[] }[]
      }
    }[]
  }[]
}

/** Inbound media is fetched lazily through our proxy (needs the channel token). */
export function waMediaProxyUrl(channelId: string, mediaId: string): string {
  return `/api/media/${channelId}/${mediaId}`
}

const STATUS = new Set(['sent', 'delivered', 'read', 'failed'])

/**
 * WhatsApp Cloud API webhook → normalized events. Media URLs are left as
 * `wa-media:<id>` placeholders; ingest rewrites them once the channel id
 * is known (see waMediaProxyUrl).
 */
export function parseWhatsAppWebhook(body: WaWebhookBody): InboundEvent[] {
  const events: InboundEvent[] = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      // Coexistence fields (history, smb_message_echoes, smb_app_state_sync)
      // carry messages that must NOT reach the inbound pipeline (AI/flows);
      // parseWhatsAppCoexistence handles them.
      if (change.field && change.field !== 'messages') continue
      const value = change.value
      const channelExternalId = value?.metadata?.phone_number_id
      if (!channelExternalId) continue

      for (const s of value.statuses ?? []) {
        if (!STATUS.has(s.status)) continue
        events.push({
          kind: 'status',
          channelExternalId,
          externalMessageId: s.id,
          status: s.status as 'sent' | 'delivered' | 'read' | 'failed',
          timestamp: parseInt(s.timestamp, 10) * 1000,
          error: s.errors?.[0]?.message ?? s.errors?.[0]?.title ?? null,
        })
      }

      for (const m of value.messages ?? []) {
        const timestamp = parseInt(m.timestamp, 10) * 1000
        if (m.type === 'system') {
          const change = identityChange(channelExternalId, m, timestamp)
          if (change) events.push(change)
          continue
        }
        const from = waSender(m, value.contacts)
        if (!from) continue

        if (m.type === 'reaction' && m.reaction?.message_id) {
          events.push({
            kind: 'reaction',
            channelExternalId,
            from: { externalId: from.externalId, userId: from.userId },
            targetExternalId: m.reaction.message_id,
            emoji: m.reaction.emoji || null,
            timestamp,
          })
          continue
        }

        const content = waMessageContent(m)
        events.push({
          kind: 'message' as const,
          channelExternalId,
          from,
          externalMessageId: m.id,
          timestamp,
          replyToExternalId: m.context?.id ?? null,
          ...content,
        })
      }
    }
  }
  return events
}

/**
 * The customer who wrote. Identified by phone when Meta shares it (as
 * before BSUIDs existed), otherwise by their BSUID. Null when neither came.
 */
export function waSender(m: WaMessage, contacts: WaContact[] | undefined): InboundSender | null {
  const phone = normalizePhone(m.from ?? '')
  const profile =
    contacts?.find((c) => (phone && c.wa_id === m.from) || (m.from_user_id && c.user_id === m.from_user_id)) ??
    contacts?.[0]
  const userId = m.from_user_id || profile?.user_id || null
  const externalId = phone || userId
  if (!externalId) return null
  const username = profile?.profile?.username
  return {
    externalId,
    name: profile?.profile?.name ?? null,
    handle: phone || (username ? `@${username}` : null),
    phone: phone || null,
    userId,
  }
}

/** System message: number change (`from` = old number, `system.wa_id` = new) or BSUID change. */
function identityChange(channelExternalId: string, m: WaMessage, timestamp: number): InboundEvent | null {
  const sys = m.system
  if (sys?.type !== 'user_changed_number' && sys?.type !== 'user_changed_user_id') return null
  const previous = { phone: normalizePhone(m.from ?? '') || null, userId: sys.previous_user_id || m.from_user_id || null }
  const current = { phone: normalizePhone(sys.wa_id ?? '') || null, userId: sys.user_id || null }
  if (!previous.phone && !previous.userId) return null
  return { kind: 'identity_change', channelExternalId, previous, current, timestamp }
}

type MessageContent = Pick<
  Extract<InboundEvent, { kind: 'message' }>,
  'contentType' | 'text' | 'mediaUrl' | 'interactiveReplyId'
>

/** Message body → normalized content (shared by inbound, echoes and history). */
export function waMessageContent(m: WaMessage): MessageContent {
  const media = (x: WaMedia | undefined) => (x?.id ? `wa-media:${x.id}` : null)
  switch (m.type) {
    case 'text':
      return { contentType: 'text', text: m.text?.body ?? '' }
    case 'image':
    case 'video':
    case 'document':
    case 'audio':
    case 'sticker': {
      const x = m[m.type]
      return {
        contentType: m.type,
        text: x?.caption ?? (m.type === 'document' ? x?.filename ?? null : null),
        mediaUrl: media(x),
      }
    }
    case 'location': {
      const l = m.location
      const text = l ? [l.name, l.address, `${l.latitude},${l.longitude}`].filter(Boolean).join(' - ') : null
      return { contentType: 'location', text }
    }
    case 'interactive': {
      const reply = m.interactive?.button_reply ?? m.interactive?.list_reply
      return {
        contentType: 'interactive',
        text: reply?.title ?? reply?.id ?? '[Interactive reply]',
        interactiveReplyId: reply?.id ?? null,
      }
    }
    case 'button':
      // Quick-reply button on a template message.
      return {
        contentType: 'interactive',
        text: m.button?.text ?? m.button?.payload ?? '',
        interactiveReplyId: m.button?.payload ?? null,
      }
    case 'media_placeholder':
      // History sync: the media itself arrives later in its own webhook.
      return { contentType: 'text', text: '[Media]' }
    default:
      return { contentType: 'text', text: `[Unsupported message type: ${m.type}]` }
  }
}

// ------------------------------------------------------------
// Coexistence (WhatsApp Business app + Cloud API on the same number)
// https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users
// ------------------------------------------------------------

/** One message mirrored from the WhatsApp Business app (echo or history). */
export interface CoexMessage {
  externalMessageId: string
  /** Customer's phone (digits). */
  customer: string
  /** true = sent by the business from the app; false = written by the customer. */
  fromBusiness: boolean
  timestamp: number
  content: MessageContent
  /** History only: status on the phone, lower-cased (read, delivered, played...). */
  phoneStatus?: string | null
  replyToExternalId?: string | null
}

export interface CoexBatch {
  phoneNumberId: string
  /** Business display number (digits), used to tell who wrote each history message. */
  businessNumber: string
  echoes: CoexMessage[]
  history: CoexMessage[]
  /** History media webhooks: content for messages first stored as placeholders. */
  historyMedia: CoexMessage[]
  historyProgress: { phase: number | null; chunk: number | null; progress: number | null } | null
  historyError: { code: number | null; message: string } | null
  contacts: { phone: string; name: string | null; action: 'add' | 'remove' | string; timestamp: number | null }[]
}

const digits = (s: string | undefined | null) => (s ?? '').replace(/\D/g, '')

/** Caps per webhook so a huge history chunk can't stall the worker. */
export const HISTORY_LIMITS = { threads: 500, messagesPerThread: 500 }

/**
 * smb_message_echoes / history / smb_app_state_sync webhook fields → one
 * batch per business number. Pure (no DB): echo.ts stores the result.
 */
export function parseWhatsAppCoexistence(body: WaWebhookBody): CoexBatch[] {
  const batches = new Map<string, CoexBatch>()
  const batchFor = (pnid: string, business: string) => {
    let b = batches.get(pnid)
    if (!b) {
      b = { phoneNumberId: pnid, businessNumber: business, echoes: [], history: [], historyMedia: [], historyProgress: null, historyError: null, contacts: [] }
      batches.set(pnid, b)
    }
    if (!b.businessNumber && business) b.businessNumber = business
    return b
  }

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value
      const pnid = value?.metadata?.phone_number_id
      if (!pnid) continue
      const business = digits(value.metadata?.display_phone_number)

      if (change.field === 'smb_message_echoes') {
        const b = batchFor(pnid, business)
        for (const m of value.message_echoes ?? []) {
          const customer = digits(m.to)
          if (!m.id || !customer) continue
          b.echoes.push({
            externalMessageId: m.id,
            customer,
            fromBusiness: true,
            timestamp: parseInt(m.timestamp, 10) * 1000,
            content: waMessageContent(m),
            replyToExternalId: m.context?.id ?? null,
          })
        }
      } else if (change.field === 'history') {
        const b = batchFor(pnid, business)
        for (const chunk of value.history ?? []) {
          const err = chunk.errors?.[0]
          if (err) {
            b.historyError = { code: err.code ?? null, message: err.message ?? err.title ?? 'History sync error' }
            continue
          }
          if (chunk.metadata) {
            b.historyProgress = {
              phase: chunk.metadata.phase ?? null,
              chunk: chunk.metadata.chunk_order ?? null,
              progress: chunk.metadata.progress ?? null,
            }
          }
          for (const thread of (chunk.threads ?? []).slice(0, HISTORY_LIMITS.threads)) {
            const customer = digits(thread.id)
            // Group chats are never synced; anything that isn't a phone is skipped.
            if (!customer || customer.length < 7 || customer.length > 15) continue
            for (const m of (thread.messages ?? []).slice(0, HISTORY_LIMITS.messagesPerThread)) {
              if (!m.id) continue
              const from = digits(m.from)
              b.history.push({
                externalMessageId: m.id,
                customer,
                fromBusiness: from !== customer,
                timestamp: parseInt(m.timestamp, 10) * 1000,
                content: waMessageContent(m),
                phoneStatus: m.history_context?.status?.toLowerCase() ?? null,
                replyToExternalId: m.context?.id ?? null,
              })
            }
          }
        }
        // Media of history messages comes as `messages` on the history field.
        for (const m of value.messages ?? []) {
          if (!m.id) continue
          const from = digits(m.from)
          const to = digits(m.to)
          const fromBusiness = !!business && from === business
          const customer = fromBusiness ? to : from
          if (!customer) continue
          b.historyMedia.push({
            externalMessageId: m.id,
            customer,
            fromBusiness,
            timestamp: parseInt(m.timestamp, 10) * 1000,
            content: waMessageContent(m),
          })
        }
      } else if (change.field === 'smb_app_state_sync') {
        const b = batchFor(pnid, business)
        for (const item of value.state_sync ?? []) {
          if (item.type !== 'contact' || !item.contact) continue
          const phone = digits(item.contact.phone_number)
          if (!phone) continue
          const name = (item.contact.full_name || item.contact.first_name || '').trim() || null
          const ts = parseInt(item.metadata?.timestamp ?? '', 10)
          b.contacts.push({ phone, name, action: item.action ?? 'add', timestamp: Number.isFinite(ts) ? ts * 1000 : null })
        }
      }
    }
  }
  return [...batches.values()].filter(
    (b) => b.echoes.length || b.history.length || b.historyMedia.length || b.contacts.length || b.historyProgress || b.historyError,
  )
}

export interface TemplateStatusUpdate {
  metaId: string
  event: string
  name: string | null
  language: string | null
  reason: string | null
}

/** message_template_status_update webhook field → review results (pure). */
export function parseTemplateStatusUpdates(body: WaWebhookBody): TemplateStatusUpdate[] {
  const out: TemplateStatusUpdate[] = []
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'message_template_status_update') continue
      const v = change.value as unknown as Record<string, unknown> | undefined
      const id = v?.message_template_id
      if (!v || (typeof id !== 'string' && typeof id !== 'number') || typeof v.event !== 'string') continue
      out.push({
        metaId: String(id),
        event: v.event,
        name: typeof v.message_template_name === 'string' ? v.message_template_name : null,
        language: typeof v.message_template_language === 'string' ? v.message_template_language : null,
        reason: typeof v.reason === 'string' ? v.reason : null,
      })
    }
  }
  return out
}
