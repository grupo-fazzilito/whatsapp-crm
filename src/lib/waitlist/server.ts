import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { isPrismaError } from '@/lib/db/errors'
import { sendMessage } from '@/lib/messaging/send'
import { conversationForContact, findOrCreateContactByPhone } from '@/lib/messaging/conversations'
import { windowState } from '@/lib/automations/followup-rules'
import type { ChannelType } from '@/lib/channels'
import { siteUrl } from '@/lib/real-estate/listing/url'
import { storePath } from '@/lib/store/settings'
import { loadStoreCatalog, type PublicStore } from '@/lib/store/server'
import { waitlistItemName, waitlistWhatsAppUrl, type WaitlistInput } from '@/lib/store/waitlist-input'
import { waitlistTemplate, waitlistTemplateComponents, waitlistUrlSuffix } from './template'

// Lista de espera: customers who asked, from the store, to be told when a
// sold-out product (or variant) is back. The team tells them with one click
// ("Notify"): a WhatsApp text while their reply window is open, the approved
// template otherwise.

type Lang = 'es' | 'en'

export const productUrl = (slug: string, productId: string) => `${siteUrl()}${storePath(slug)}/producto/${productId}`

export type JoinResult = { ok: true; wa_url: string | null } | { ok: false; error: 'product' | 'off' | 'in_stock' }

/** Public store: adds the customer to the product's waitlist (once per phone). */
export async function joinWaitlist(store: PublicStore, input: WaitlistInput): Promise<JoinResult> {
  const ws = store.workspace
  const product = (await loadStoreCatalog(ws, input.product_id)).products[0]
  if (!product) return { ok: false, error: 'product' }
  if (!product.waitlist) return { ok: false, error: 'off' }
  let variantName: string | null = null
  if (product.variants.length) {
    const v = product.variants.find((x) => x.id === input.variant_id)
    if (!v) return { ok: false, error: 'product' }
    if (v.available !== 0) return { ok: false, error: 'in_stock' }
    variantName = v.name
  } else {
    if (input.variant_id) return { ok: false, error: 'product' }
    if (product.available !== 0) return { ok: false, error: 'in_stock' }
  }

  const db = tenantDb(ws.id)
  const contactId = await findOrCreateContactByPhone(ws.id, input.phone, input.name)
  // A contact created from a bare number gets the name the customer typed.
  if (contactId && input.name) {
    await db.contacts.updateMany({ where: { id: contactId, OR: [{ name: null }, { name: '' }, { name: `+${input.phone}` }] }, data: { name: input.name } }).catch(() => undefined)
  }
  const where = { product_id: product.id, variant_id: input.variant_id, phone: input.phone, status: 'waiting' }
  const existing = await db.stock_waitlist.findFirst({ where, select: { id: true } })
  if (existing) {
    if (input.name) await db.stock_waitlist.updateMany({ where: { id: existing.id }, data: { name: input.name } })
  } else {
    try {
      await db.stock_waitlist.create({
        data: { workspace_id: ws.id, product_id: product.id, variant_id: input.variant_id, phone: input.phone, name: input.name, contact_id: contactId },
      })
    } catch (err) {
      // Same phone joined at the same time (unique index): already waiting.
      if (!isPrismaError(err, 'P2002')) throw err
    }
  }
  const item = waitlistItemName(product.name, variantName)
  return { ok: true, wa_url: store.whatsapp ? waitlistWhatsAppUrl(store.whatsapp, ws.locale, item, input.name, productUrl(ws.slug, product.id)) : null }
}

// ------------------------------------------------------------------
// Team side
// ------------------------------------------------------------------
export type WaitlistStatus = 'waiting' | 'notified'

export interface WaitlistEntry {
  id: string
  name: string | null
  phone: string
  contact_id: string | null
  conversation_id: string | null
  status: WaitlistStatus
  created_at: string
  notified_at: string | null
  notify_error: string | null
}

export interface WaitlistGroup {
  /** product id + variant id */
  key: string
  product: { id: string; name: string; image: string | null; is_active: boolean }
  variant: { id: string; name: string } | null
  /** Units left now; null = stock not tracked (always available). */
  available: number | null
  entries: WaitlistEntry[]
}

const ENTRY_SELECT = {
  id: true,
  name: true,
  phone: true,
  contact_id: true,
  conversation_id: true,
  status: true,
  created_at: true,
  notified_at: true,
  notify_error: true,
  product_id: true,
  variant_id: true,
  products: { select: { id: true, name: true, images: true, is_active: true, track_stock: true, stock: true } },
  product_variants: { select: { id: true, name: true, stock: true, is_active: true } },
} as const

const iso = (d: Date | string | null) => (d ? new Date(d).toISOString() : null)

function leftOf(p: { track_stock: boolean; stock: number | null }, v: { stock: number | null; is_active: boolean } | null): number | null {
  if (!p.track_stock) return null
  if (v && !v.is_active) return 0
  return Math.max(0, (v ? (v.stock ?? p.stock) : p.stock) ?? 0)
}

/** Waiting (or already notified) customers, one group per product / variant: ready to notify first. */
export async function listWaitlist(workspaceId: string, status: WaitlistStatus): Promise<WaitlistGroup[]> {
  const rows = await tenantDb(workspaceId).stock_waitlist.findMany({
    where: { status },
    select: ENTRY_SELECT,
    orderBy: status === 'waiting' ? { created_at: 'asc' } : { notified_at: 'desc' },
    take: 3000,
  })
  const groups = new Map<string, WaitlistGroup>()
  for (const r of rows) {
    const key = `${r.product_id}:${r.variant_id ?? ''}`
    let g = groups.get(key)
    if (!g) {
      const p = r.products
      g = {
        key,
        product: { id: p.id, name: p.name, image: p.images.find((u) => /^https?:\/\//.test(u) || u.startsWith('/')) ?? null, is_active: p.is_active },
        variant: r.product_variants ? { id: r.product_variants.id, name: r.product_variants.name } : null,
        available: p.is_active ? leftOf(p, r.product_variants) : 0,
        entries: [],
      }
      groups.set(key, g)
    }
    g.entries.push({
      id: r.id,
      name: r.name,
      phone: r.phone,
      contact_id: r.contact_id,
      conversation_id: r.conversation_id,
      status: r.status as WaitlistStatus,
      created_at: iso(r.created_at)!,
      notified_at: iso(r.notified_at),
      notify_error: r.notify_error,
    })
  }
  const ready = (g: WaitlistGroup) => g.available === null || g.available > 0
  return [...groups.values()].sort((a, b) => Number(ready(b)) - Number(ready(a)) || b.entries.length - a.entries.length || a.product.name.localeCompare(b.product.name))
}

/** Why one customer wasn't notified (stock_waitlist.notify_error). */
export type NotifySkip = 'no_stock' | 'no_channel' | 'window_closed' | 'template_missing' | 'template_pending' | 'template_rejected' | 'send_failed'

export interface NotifyResult {
  sent: number
  failed: { id: string; reason: NotifySkip }[]
}

interface NotifyWs {
  id: string
  name: string
  slug: string
  locale: string
}

/** Sends the "back in stock" WhatsApp to these waiting customers. */
export async function notifyWaitlist(ws: NotifyWs, userId: string, ids: string[]): Promise<NotifyResult> {
  const db = tenantDb(ws.id)
  const lang: Lang = ws.locale === 'en' ? 'en' : 'es'
  const rows = await db.stock_waitlist.findMany({ where: { id: { in: ids.slice(0, 500) }, status: 'waiting' }, select: ENTRY_SELECT })
  const out: NotifyResult = { sent: 0, failed: [] }
  let template: Awaited<ReturnType<typeof waitlistTemplate>> | undefined
  for (const r of rows) {
    const fail = async (reason: NotifySkip) => {
      out.failed.push({ id: r.id, reason })
      await db.stock_waitlist.updateMany({ where: { id: r.id }, data: { notify_error: reason } }).catch(() => undefined)
    }
    const left = r.products.is_active ? leftOf(r.products, r.product_variants) : 0
    if (left === 0) {
      await fail('no_stock')
      continue
    }
    const contactId = r.contact_id ?? (await findOrCreateContactByPhone(ws.id, r.phone, r.name))
    const conversationId = contactId ? await conversationForContact(ws.id, contactId) : null
    if (!conversationId) {
      await fail('no_channel')
      continue
    }
    const conv = await db.conversations
      .findFirst({ where: { id: conversationId }, select: { last_customer_message_at: true, channels: { select: { type: true } } } })
      .catch(() => null)
    const channelType = (conv?.channels?.type ?? 'whatsapp') as ChannelType
    const item = waitlistItemName(r.products.name, r.product_variants?.name ?? null)
    const url = productUrl(ws.slug, r.product_id)
    const name = (r.name ?? '').trim()
    const metadata = { source: 'waitlist', waitlist_id: r.id, product_id: r.product_id }

    let sent: Awaited<ReturnType<typeof sendMessage>>
    if (windowState(channelType, (conv?.last_customer_message_at as string | null) ?? null).open) {
      const hi = lang === 'es' ? (name ? `Hola ${name}` : 'Hola') : name ? `Hi ${name}` : 'Hi'
      const text =
        lang === 'es'
          ? `${hi}, ¡buenas noticias! Ya tenemos stock de ${item}, como nos pediste. Puedes pedirlo aquí: ${url}`
          : `${hi}, good news! ${item} is back in stock, as you asked. You can order it here: ${url}`
      sent = await sendMessage({ workspaceId: ws.id, conversationId, content: { type: 'text', text }, sender: { type: 'agent', userId }, metadata })
    } else {
      if (channelType !== 'whatsapp') {
        await fail('window_closed')
        continue
      }
      if (template === undefined) template = await waitlistTemplate(ws.id, lang)
      if (!template) {
        await fail('template_missing')
        continue
      }
      if (template.status === 'Rejected') {
        await fail('template_rejected')
        continue
      }
      if (template.status !== 'Approved') {
        await fail('template_pending')
        continue
      }
      const { components, text } = waitlistTemplateComponents({ name, item, business: ws.name, suffix: waitlistUrlSuffix(ws.slug, r.product_id) }, lang)
      sent = await sendMessage({
        workspaceId: ws.id,
        conversationId,
        content: { type: 'template', templateName: template.name, language: template.language, components },
        sender: { type: 'agent', userId },
        metadata: { ...metadata, template: template.name },
      })
      // The inbox shows what the customer read, not "[Template: …]".
      if (sent.messageId) await db.messages.updateMany({ where: { id: sent.messageId }, data: { content_text: text } }).catch(() => undefined)
    }
    if (sent.status === 'failed') {
      console.error(`[waitlist] notify ${r.id} failed:`, sent.error)
      await fail('send_failed')
      continue
    }
    await db.stock_waitlist.updateMany({
      where: { id: r.id },
      data: { status: 'notified', notified_at: new Date(), notified_by: userId, notify_error: null, conversation_id: conversationId, contact_id: contactId },
    })
    out.sent++
  }
  return out
}

export interface WaitlistSummary {
  /** Per product: people waiting, and how many of them can be notified now (it has stock). */
  products: Record<string, { waiting: number; ready: number }>
  /** Products with stock again and people waiting for them. */
  readyProducts: number
  readyPeople: number
}

/** For the catalog list: who is waiting for each product and who can be told now. */
export async function waitlistSummary(workspaceId: string): Promise<WaitlistSummary> {
  const groups = await listWaitlist(workspaceId, 'waiting')
  const out: WaitlistSummary = { products: {}, readyProducts: 0, readyPeople: 0 }
  const readyIds = new Set<string>()
  for (const g of groups) {
    const ready = g.product.is_active && (g.available === null || g.available > 0)
    const row = (out.products[g.product.id] ??= { waiting: 0, ready: 0 })
    row.waiting += g.entries.length
    if (ready) {
      row.ready += g.entries.length
      out.readyPeople += g.entries.length
      readyIds.add(g.product.id)
    }
  }
  out.readyProducts = readyIds.size
  return out
}
