import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { normalizeRaw } from '@/lib/db/compat'
import { Prisma } from '@/generated/prisma/client'
import { sendMessage } from '@/lib/messaging/send'
import { createTranslator } from '@/i18n/translate'
import { formatMoney, moneyLocale } from '@/lib/workspace/countries'
import type { CarouselCard } from '@/lib/channels'
import { propertyUrl } from '@/lib/real-estate/listing/url'
import { coordsFrom } from '@/lib/real-estate/listing/geo'
import { listingOperation } from './profile'
import { propertyCurrency, rankProperties } from './match'
import type { LeadFields, MatchProperty, PropertyMatch } from './types'

// Listings for leads: candidate loading, ranking and sending to the chat.

export const PRODUCT_SELECT = { id: true, name: true, price: true, currency: true, images: true, attributes: true, is_active: true } as const
/** Listings scanned per lead (agencies rarely have more active ones). */
const SCAN_LIMIT = 500

export interface WsLite {
  id: string
  name: string
  slug: string
  locale: string
  country: string | null
  currency: string
}

export async function loadWs(workspaceId: string): Promise<WsLite | null> {
  const data = await tenantDb(workspaceId)
    .workspaces.findFirst({ select: { id: true, name: true, slug: true, locale: true, country: true, currency: true }, where: { id: workspaceId } })
    .catch(() => null)
  return (data as WsLite) ?? null
}

function toProperty(row: Record<string, unknown>): MatchProperty {
  return {
    id: row.id as string,
    name: row.name as string,
    price: row.price === null || row.price === undefined ? null : Number(row.price),
    currency: (row.currency as string | null | undefined) ?? null,
    images: (row.images as string[]) ?? [],
    attributes: (row.attributes as Record<string, unknown>) ?? {},
    is_active: !!row.is_active,
  }
}

/**
 * Top matching active listings for a lead (the "Coincidencias" list):
 * a search_products-like prefilter in SQL (operation, price window), then
 * the pure matcher ranks.
 */
export async function matchingProperties(
  workspaceId: string,
  lead: Partial<LeadFields>,
  opts: { limit?: number; excludeIds?: string[] } = {},
): Promise<PropertyMatch[]> {
  const ws = await loadWs(workspaceId)
  if (!ws) return []
  // Raw SQL for the jsonb prefilter; the workspace filter is explicit.
  const filters: Prisma.Sql[] = [Prisma.sql`workspace_id = ${workspaceId}::uuid`, Prisma.sql`is_active = true`]
  const op = listingOperation(lead.operation ?? null)
  if (op) filters.push(Prisma.sql`(attributes->>'operation' IS NULL OR attributes->>'operation' = ${op})`)
  if (lead.budget_max) {
    // The price window only applies to listings in the lead's currency
    // (unknown = workspace currency); the matcher re-checks every row.
    const cur = (lead.currency || ws.currency).toUpperCase()
    if (/^[A-Z]{3}$/.test(cur)) {
      const other = cur === ws.currency.toUpperCase() ? Prisma.sql`currency <> ${cur}` : Prisma.sql`currency IS NULL OR currency <> ${cur}`
      filters.push(Prisma.sql`(price IS NULL OR price <= ${Math.ceil(lead.budget_max * 1.1)} OR ${other})`)
    }
  }
  let data: Record<string, unknown>[]
  try {
    data = normalizeRaw(
      await prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT id, name, price, currency, images, attributes, is_active
        FROM public.products
        WHERE ${Prisma.join(filters, ' AND ')}
        ORDER BY is_featured DESC, updated_at DESC NULLS FIRST
        LIMIT ${SCAN_LIMIT}`,
    )
  } catch (err) {
    console.error('[leads] listing scan failed:', err instanceof Error ? err.message : err)
    return []
  }
  const exclude = new Set(opts.excludeIds ?? [])
  const rows = (data ?? []).map(toProperty).filter((p) => !exclude.has(p.id))
  return rankProperties(lead, rows, opts.limit ?? 10, { listingCurrency: ws.currency })
}

export async function loadProperty(workspaceId: string, productId: string): Promise<MatchProperty | null> {
  const data = await tenantDb(workspaceId)
    .products.findFirst({ select: PRODUCT_SELECT, where: { id: productId } })
    .catch(() => null)
  return data ? toProperty(data) : null
}

function lang(ws: WsLite): 'es' | 'en' {
  return ws.locale === 'en' ? 'en' : 'es'
}

/** "S/ 2,800.00 · Miraflores · 2 dorm." */
export function propertySubtitle(ws: WsLite, p: MatchProperty): string {
  const t = createTranslator(lang(ws))
  const money = (n: number) => formatMoney(n, propertyCurrency(p, ws.currency), moneyLocale({ locale: lang(ws), country: ws.country }))
  const beds = Number(p.attributes.bedrooms)
  return [
    p.price === null ? t('leads.server.priceOnRequest') : money(p.price),
    typeof p.attributes.zone === 'string' ? p.attributes.zone : '',
    Number.isFinite(beds) && beds > 0 ? t('leads.server.bedrooms', { count: beds }) : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export interface SendCtx {
  workspaceId: string
  conversationId: string
  aiAgentId?: string | null
  userId?: string | null
}

async function say(ctx: SendCtx, content: Parameters<typeof sendMessage>[0]['content'], metadata?: Record<string, unknown>) {
  return sendMessage({
    workspaceId: ctx.workspaceId,
    conversationId: ctx.conversationId,
    content,
    sender: ctx.userId ? { type: 'agent', userId: ctx.userId } : { type: 'bot', aiAgentId: ctx.aiAgentId ?? null },
    metadata,
  })
}

/**
 * Sends listings to a conversation: an intro with the public links, then
 * a carousel (photo, price, "Agendar visita" button). Listings without
 * a photo only appear in the text. Returns how many were sent.
 */
export async function sendProperties(ctx: SendCtx, properties: MatchProperty[], intro: string, event = 'property_match'): Promise<number> {
  const ws = await loadWs(ctx.workspaceId)
  if (!ws || !properties.length) return 0
  const t = createTranslator(lang(ws))
  const list = properties.slice(0, 10)
  const lines = list.map((p, i) => `${list.length > 1 ? `${i + 1}. ` : ''}*${p.name}* — ${propertySubtitle(ws, p)}\n${propertyUrl(ws, p)}`)
  const ids = list.map((p) => p.id)
  const first = await say(ctx, { type: 'text', text: [intro, '', ...lines].join('\n') }, { event, product_ids: ids })
  if (first.status === 'failed') return 0
  const cards: CarouselCard[] = list
    .filter((p) => p.images[0])
    .map((p) => ({
      id: p.id,
      imageUrl: p.images[0],
      title: p.name,
      subtitle: propertySubtitle(ws, p),
      buttons: [{ id: `visit:book:${p.id}`, title: t('leads.server.bookButton') }],
    }))
  if (cards.length) await say(ctx, { type: 'carousel', text: intro, cards }, { event, product_ids: cards.map((c) => c.id) })
  return list.length
}

/** Native map pin of a listing (WhatsApp) or a Maps link (others). */
export async function sendPropertyLocation(ctx: SendCtx, p: MatchProperty, metadata?: Record<string, unknown>): Promise<boolean> {
  const coords = coordsFrom(p.attributes)
  if (!coords) return false
  const address = [p.attributes.address, p.attributes.zone].filter((x) => typeof x === 'string' && x.trim()).join(', ')
  const res = await say(
    ctx,
    { type: 'location', latitude: coords.lat, longitude: coords.lng, name: p.name.slice(0, 100), ...(address ? { address } : {}) },
    { event: 'viewing_location', product_id: p.id, ...metadata },
  )
  return res.status !== 'failed'
}

/** "Coincidencias" of a contact: top 10 active listings for their lead profile. */
export async function leadMatches(workspaceId: string, contactId: string, limit = 10): Promise<PropertyMatch[]> {
  const data = await tenantDb(workspaceId)
    .lead_profiles.findFirst({
      select: {
        operation: true,
        property_types: true,
        zones: true,
        budget_min: true,
        budget_max: true,
        currency: true,
        bedrooms_min: true,
        bathrooms_min: true,
        parking_min: true,
      },
      where: { contact_id: contactId },
    })
    .catch(() => null)
  if (!data || !(data.operation || (data.zones as string[] | null)?.length)) return []
  const lead: Partial<LeadFields> = {
    ...(data as Partial<LeadFields>),
    budget_min: data.budget_min === null ? null : Number(data.budget_min),
    budget_max: data.budget_max === null ? null : Number(data.budget_max),
  }
  return matchingProperties(workspaceId, lead, { limit })
}
