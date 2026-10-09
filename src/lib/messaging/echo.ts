import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { waMediaProxyUrl, type CoexBatch, type CoexMessage } from '@/lib/channels/parsers/whatsapp'
import type { LoadedChannel } from '@/lib/channels'
import { findOrCreateContact, findOrCreateConversation } from './ingest'

// WhatsApp coexistence: the business keeps using the WhatsApp Business app
// on its phone while the number is connected to the Cloud API. Meta mirrors
// what happens on the phone through three webhook fields:
//   - smb_message_echoes: messages the business sent from the app
//   - history:            past chats (≤180 days) shared once after onboarding
//   - smb_app_state_sync: the app's address book
// None of this is a new customer message: it never reaches AI, flows or
// automations. Echoes count as human replies (sender_type 'agent') and
// pause the AI agent for that conversation like an inbox takeover.
// https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users

/** Same pause as replying from the inbox (src/app/api/whatsapp/send). */
export const HUMAN_TAKEOVER_MS = 12 * 60 * 60 * 1000
export const COEX_SOURCE = 'whatsapp_business_app'

const DB_CONTENT_TYPE: Record<CoexMessage['content']['contentType'], string> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  document: 'document',
  location: 'location',
  sticker: 'image',
  interactive: 'interactive',
}

const PHONE_STATUS: Record<string, 'sent' | 'delivered' | 'read'> = {
  sent: 'sent',
  server_ack: 'sent',
  delivered: 'delivered',
  delivery_ack: 'delivered',
  read: 'read',
  played: 'read',
}

export function mediaUrlFor(channelId: string, url: string | null | undefined): string | null {
  if (!url) return null
  return url.startsWith('wa-media:') ? waMediaProxyUrl(channelId, url.slice('wa-media:'.length)) : url
}

/** messages row for a mirrored message (no ids that need DB lookups). */
export function coexMessageRow(
  m: CoexMessage,
  ctx: { workspaceId: string; conversationId: string; channelId: string; history: boolean },
) {
  const status = m.fromBusiness ? (PHONE_STATUS[m.phoneStatus ?? ''] ?? (ctx.history ? 'delivered' : 'sent')) : ctx.history ? 'read' : 'delivered'
  return {
    workspace_id: ctx.workspaceId,
    conversation_id: ctx.conversationId,
    sender_type: m.fromBusiness ? 'agent' : 'customer',
    sender_id: null,
    content_type: DB_CONTENT_TYPE[m.content.contentType],
    content_text: m.content.text,
    media_url: mediaUrlFor(ctx.channelId, m.content.mediaUrl),
    message_id: m.externalMessageId,
    status,
    created_at: new Date(m.timestamp).toISOString(),
    interactive_reply_id: m.content.interactiveReplyId ?? null,
    metadata: ctx.history ? { source: COEX_SOURCE, history: true } : { source: COEX_SOURCE },
  }
}

/** A stored name that is just a phone / placeholder may be replaced by the app's address book name. */
export function isPlaceholderName(name: string | null | undefined, phone: string): boolean {
  if (!name || !name.trim()) return true
  const d = name.replace(/\D/g, '')
  if (d && d.length >= 7 && name.replace(/[\d\s+()-]/g, '') === '') return true
  return d === phone || /^whatsapp \d{4}$/i.test(name.trim())
}

/** Group by customer, preserving order and dropping duplicate ids. */
export function groupByCustomer(list: CoexMessage[]): Map<string, CoexMessage[]> {
  const seen = new Set<string>()
  const out = new Map<string, CoexMessage[]>()
  for (const m of list) {
    if (seen.has(m.externalMessageId)) continue
    seen.add(m.externalMessageId)
    const arr = out.get(m.customer) ?? []
    arr.push(m)
    out.set(m.customer, arr)
  }
  return out
}

function preview(m: CoexMessage): string {
  return m.content.text || `[${m.content.contentType}]`
}

async function threadFor(channel: LoadedChannel, customer: string) {
  const contact = await findOrCreateContact(channel, { externalId: customer, phone: customer, handle: customer, name: null })
  if (!contact) return null
  const conversation = await findOrCreateConversation(channel, contact.id)
  if (!conversation) return null
  return { contactId: contact.id, conversation }
}

async function existingIds(workspaceId: string, ids: string[]): Promise<Set<string>> {
  const found = new Set<string>()
  for (let i = 0; i < ids.length; i += 200) {
    const data = await tenantDb(workspaceId).messages.findMany({
      where: { message_id: { in: ids.slice(i, i + 200) } },
      select: { message_id: true },
    })
    for (const r of data) if (r.message_id) found.add(r.message_id)
  }
  return found
}

async function replyTargets(workspaceId: string, conversationId: string, ids: (string | null | undefined)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))]
  if (!wanted.length) return new Map()
  const data = await tenantDb(workspaceId).messages.findMany({
    where: { conversation_id: conversationId, message_id: { in: wanted.slice(0, 200) } },
    select: { id: true, message_id: true },
  })
  return new Map(data.map((r) => [r.message_id as string, r.id]))
}

// ------------------------------------------------------------
// smb_message_echoes
// ------------------------------------------------------------
export async function storeEchoes(channel: LoadedChannel, echoes: CoexMessage[]): Promise<number> {
  const ws = channel.workspace_id
  const db = tenantDb(ws)
  let stored = 0
  for (const [customer, list] of groupByCustomer(echoes)) {
    const thread = await threadFor(channel, customer)
    if (!thread) continue
    const { conversation, contactId } = thread
    const known = await existingIds(ws, list.map((m) => m.externalMessageId))
    const fresh = list.filter((m) => !known.has(m.externalMessageId))
    if (!fresh.length) continue
    const replies = await replyTargets(ws, conversation.id, fresh.map((m) => m.replyToExternalId))
    const rows = fresh.map((m) => ({
      ...coexMessageRow(m, { workspaceId: ws, conversationId: conversation.id, channelId: channel.id, history: false }),
      reply_to_message_id: m.replyToExternalId ? replies.get(m.replyToExternalId) ?? null : null,
    }))
    try {
      await db.messages.createMany({ data: rows })
    } catch (error) {
      console.error('[echo] insert failed:', error instanceof Error ? error.message : error)
      continue
    }
    stored += rows.length

    const last = fresh[fresh.length - 1]
    const pauseUntil = new Date(Date.now() + HUMAN_TAKEOVER_MS)
    const currentPause = conversation.ai_paused_until ? new Date(conversation.ai_paused_until) : null
    await db.conversations
      .updateMany({
        where: { id: conversation.id },
        data: {
        last_message_text: preview(last),
        last_message_at: new Date(last.timestamp).toISOString(),
        updated_at: new Date().toISOString(),
        // A person is answering from the phone: keep the AI agent quiet.
        ai_paused_until: (currentPause && currentPause > pauseUntil ? currentPause : pauseUntil).toISOString(),
        },
      })
      .catch(() => {})

    // Same as an inbox reply: an active flow run yields to the human.
    try {
      await db.flow_runs.updateMany({
        where: { contact_id: contactId, status: 'active' },
        data: { status: 'paused_by_agent', ended_at: new Date().toISOString(), end_reason: 'agent_replied' },
      })
    } catch (flowErr) {
      console.error('[echo] flow pause failed:', flowErr instanceof Error ? flowErr.message : flowErr)
    }
  }
  return stored
}

// ------------------------------------------------------------
// history
// ------------------------------------------------------------
export async function importHistory(channel: LoadedChannel, history: CoexMessage[]): Promise<number> {
  const ws = channel.workspace_id
  const db = tenantDb(ws)
  let imported = 0
  for (const [customer, list] of groupByCustomer(history)) {
    const thread = await threadFor(channel, customer)
    if (!thread) continue
    const { conversation } = thread
    const known = await existingIds(ws, list.map((m) => m.externalMessageId))
    const fresh = list.filter((m) => !known.has(m.externalMessageId)).sort((a, b) => a.timestamp - b.timestamp)
    if (!fresh.length) continue
    const rows = fresh.map((m) => coexMessageRow(m, { workspaceId: ws, conversationId: conversation.id, channelId: channel.id, history: true }))
    for (let i = 0; i < rows.length; i += 500) {
      try {
        await db.messages.createMany({ data: rows.slice(i, i + 500) })
        imported += Math.min(500, rows.length - i)
      } catch (error) {
        console.error('[history] insert failed:', error instanceof Error ? error.message : error)
      }
    }

    // Only move the conversation preview forward (history is older than live traffic).
    const newest = fresh[fresh.length - 1]
    const newestCustomer = [...fresh].reverse().find((m) => !m.fromBusiness)
    const update: Record<string, string> = {}
    if (!conversation.last_message_at || new Date(conversation.last_message_at).getTime() < newest.timestamp) {
      update.last_message_text = preview(newest)
      update.last_message_at = new Date(newest.timestamp).toISOString()
    }
    if (
      newestCustomer &&
      (!conversation.last_customer_message_at || new Date(conversation.last_customer_message_at).getTime() < newestCustomer.timestamp)
    ) {
      update.last_customer_message_at = new Date(newestCustomer.timestamp).toISOString()
    }
    if (Object.keys(update).length) {
      await db.conversations.updateMany({ where: { id: conversation.id }, data: update }).catch(() => {})
    }
  }
  return imported
}

/** History media arrives after the thread (as `media_placeholder`): fill it in. */
export async function applyHistoryMedia(channel: LoadedChannel, media: CoexMessage[]): Promise<void> {
  const ws = channel.workspace_id
  const db = tenantDb(ws)
  const missing: CoexMessage[] = []
  for (const m of media) {
    // maybeSingle(): more than one match counted as none.
    const found = await db.messages.findMany({ where: { message_id: m.externalMessageId }, select: { id: true }, take: 2 })
    const row = found.length === 1 ? found[0] : null
    if (!row) {
      missing.push(m)
      continue
    }
    await db.messages
      .updateMany({
        where: { id: row.id },
        data: {
          content_type: DB_CONTENT_TYPE[m.content.contentType],
          content_text: m.content.text,
          media_url: mediaUrlFor(channel.id, m.content.mediaUrl),
        },
      })
      .catch(() => {})
  }
  if (missing.length) await importHistory(channel, missing)
}

async function saveHistoryState(channel: LoadedChannel, batch: CoexBatch, imported: number) {
  if (!batch.historyProgress && !batch.historyError && !imported) return
  const db = tenantDb(channel.workspace_id)
  const data = await db.channels.findFirst({ where: { id: channel.id }, select: { settings: true } }).catch(() => null)
  const settings = (data?.settings ?? {}) as Record<string, unknown>
  const sync = (settings.coexistence_sync ?? {}) as Record<string, unknown>
  const prev = (sync.history ?? {}) as Record<string, unknown>
  const history = {
    ...prev,
    ...(batch.historyProgress ?? {}),
    imported: (typeof prev.imported === 'number' ? prev.imported : 0) + imported,
    ...(batch.historyError ? { error: batch.historyError } : {}),
    updated_at: new Date().toISOString(),
  }
  await db.channels
    .updateMany({ where: { id: channel.id }, data: { settings: { ...settings, coexistence_sync: { ...sync, history } } as object } })
    .catch(() => {})
}

// ------------------------------------------------------------
// smb_app_state_sync (contacts)
// ------------------------------------------------------------
export async function syncAppContacts(channel: LoadedChannel, contacts: CoexBatch['contacts']): Promise<number> {
  const db = tenantDb(channel.workspace_id)
  let changed = 0
  for (const c of contacts) {
    // Removing a contact from the phone's address book doesn't delete CRM data.
    if (c.action === 'remove') continue
    const contact = await findOrCreateContact(channel, { externalId: c.phone, phone: c.phone, handle: c.phone, name: c.name })
    if (!contact) continue
    if (contact.wasCreated) {
      changed++
      continue
    }
    if (!c.name) continue
    const row = await db.contacts.findFirst({ where: { id: contact.id }, select: { name: true } }).catch(() => null)
    if (row && isPlaceholderName(row.name, c.phone)) {
      await db.contacts.updateMany({ where: { id: contact.id }, data: { name: c.name.slice(0, 200) } }).catch(() => {})
      changed++
    }
  }
  return changed
}

/** Entry point from the Meta webhook for one business number. */
export async function applyCoexBatch(channel: LoadedChannel, batch: CoexBatch): Promise<void> {
  if (batch.contacts.length) await syncAppContacts(channel, batch.contacts)
  let imported = 0
  if (batch.history.length) imported += await importHistory(channel, batch.history)
  if (batch.historyMedia.length) await applyHistoryMedia(channel, batch.historyMedia)
  await saveHistoryState(channel, batch, imported)
  if (batch.echoes.length) await storeEchoes(channel, batch.echoes)
}
