import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { addDays, safeTimeZone, zonedNow } from './time'
import type { Workspace } from '@/lib/workspace/types'
import type { AiAgentRow } from './types'
import type { BookingRow, BusinessException, BusinessHoursRow, BusyInterval, StaffRow } from './slots'
import { loadStaffBusy } from '@/lib/integrations/google/busy'
import { loadCalendlyLinks, type CalendlyServiceLink } from '@/lib/integrations/calendly/booking'

export interface ServiceRow {
  id: string
  name: string
  description: string | null
  price: number | null
  price_is_from: boolean
  duration_minutes: number | null
  category: string | null
  is_active: boolean
}

export interface StaffFull extends StaffRow {
  title: string | null
  bio: string | null
  fee: number | null
  languages: string | null
  service_ids: string[]
}

export interface FaqRow {
  id: string
  question: string
  answer: string
  keywords: string | null
  ai_agent_ids: string[] | null
}

export interface CatalogProduct {
  id: string
  name: string
  description: string | null
  price: number | null
  /** ISO 4217; null = workspace currency. */
  currency?: string | null
  category_id: string | null
  stock: number | null
  track_stock: boolean
  images: string[]
  attributes: Record<string, unknown>
  is_featured: boolean
}

export interface CatalogSummary {
  categories: { id: string; name: string }[]
  total: number
  /** Whole catalog when it is small enough to put in the prompt. */
  products: CatalogProduct[] | null
}

/** Up to this many active products go straight into the prompt. */
export const SMALL_CATALOG = 25

export interface BusinessContext {
  workspace: Workspace
  timeZone: string
  hours: BusinessHoursRow[]
  exceptions: BusinessException[]
  staff: StaffFull[]
  services: ServiceRow[]
  faqs: FaqRow[]
  agents: AiAgentRow[]
  /** Active bookings from today on (horizon BOOKING_HORIZON_DAYS). */
  bookings: (BookingRow & { id: string })[]
  /** Google Calendar busy time per staff id (also set on each staff row). */
  busy?: Record<string, BusyInterval[]>
  catalog: CatalogSummary
  /** Services booked in Calendly: service id → event type. */
  calendly?: Record<string, CalendlyServiceLink>
}

export const BOOKING_HORIZON_DAYS = 14
const TTL_MS = 60_000
const cache = new Map<string, { at: number; ctx: BusinessContext }>()

export function invalidateBusinessContext(workspaceId: string) {
  cache.delete(workspaceId)
}

/** Everything the agent needs about the business, cached for a minute. */
export async function loadBusinessContext(workspaceId: string, fresh = false): Promise<BusinessContext | null> {
  const hit = cache.get(workspaceId)
  if (!fresh && hit && Date.now() - hit.at < TTL_MS) return hit.ctx

  const db = tenantDb(workspaceId)
  // Like the old PostgREST reads: a failed read counts as no rows.
  const soft = <T>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback)
  const workspace = await soft(db.workspaces.findFirst({ where: { id: workspaceId } }), null)
  if (!workspace) return null
  const timeZone = safeTimeZone(workspace.timezone)
  const today = zonedNow(timeZone).date

  const [hours, staff, links, services, faqs, agents, bookings, categories, total, calendly] = await Promise.all([
    soft(db.business_hours.findMany({ where: { workspace_id: workspaceId } }), []),
    soft(db.staff.findMany({ where: { workspace_id: workspaceId, is_active: true }, orderBy: { name: 'asc' } }), []),
    soft(db.staff_services.findMany({ select: { staff_id: true, service_id: true }, where: { workspace_id: workspaceId } }), []),
    soft(db.services.findMany({ where: { workspace_id: workspaceId, is_active: true }, orderBy: { name: 'asc' } }), []),
    soft(db.faqs.findMany({ select: { id: true, question: true, answer: true, keywords: true, ai_agent_ids: true }, where: { workspace_id: workspaceId } }), []),
    soft(db.ai_agents.findMany({ where: { workspace_id: workspaceId, enabled: true } }), []),
    soft(
      db.bookings.findMany({
        select: { id: true, staff_id: true, booking_date: true, booking_time: true, duration_minutes: true, status: true, party_size: true },
        where: {
          workspace_id: workspaceId,
          booking_date: { gte: today, lte: addDays(today, BOOKING_HORIZON_DAYS) },
          status: { in: ['pending', 'confirmed'] },
        },
      }),
      [],
    ),
    soft(
      db.product_categories.findMany({
        select: { id: true, name: true },
        where: { workspace_id: workspaceId, is_active: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
      }),
      [],
    ),
    soft(db.products.count({ where: { workspace_id: workspaceId, is_active: true } }), 0),
    soft(loadCalendlyLinks(workspaceId), {} as Record<string, CalendlyServiceLink>),
  ])
  const smallCatalog =
    total > 0 && total <= SMALL_CATALOG
      ? await soft(
          db.products.findMany({
            select: { id: true, name: true, description: true, price: true, currency: true, category_id: true, stock: true, track_stock: true, images: true, attributes: true, is_featured: true },
            where: { workspace_id: workspaceId, is_active: true },
            orderBy: [{ is_featured: 'desc' }, { sort_order: 'asc' }, { name: 'asc' }],
          }),
          null,
        )
      : null

  // External calendars: failures are logged inside and never block.
  let busy: Record<string, BusyInterval[]> = {}
  if (staff.length > 0) {
    try {
      busy = await loadStaffBusy(workspaceId, timeZone, today, BOOKING_HORIZON_DAYS, { fresh })
    } catch (err) {
      console.warn('[ai-context] calendar busy time unavailable:', err instanceof Error ? err.message : err)
    }
  }

  const servicesByStaff = new Map<string, string[]>()
  for (const l of links) {
    servicesByStaff.set(l.staff_id, [...(servicesByStaff.get(l.staff_id) ?? []), l.service_id])
  }

  const ctx: BusinessContext = {
    workspace: workspace as unknown as Workspace,
    timeZone,
    hours: hours as BusinessHoursRow[],
    exceptions: ((workspace as unknown as { date_exceptions?: BusinessException[] }).date_exceptions ?? []) as BusinessException[],
    staff: staff.map((s) => ({ ...s, service_ids: servicesByStaff.get(s.id) ?? [], busy: busy[s.id] ?? null })) as StaffFull[],
    services: services as ServiceRow[],
    faqs: faqs as FaqRow[],
    agents: agents as AiAgentRow[],
    bookings: bookings as BusinessContext['bookings'],
    busy,
    catalog: {
      categories: categories as CatalogSummary['categories'],
      total,
      products: (smallCatalog ?? null) as CatalogProduct[] | null,
    },
    calendly,
  }
  cache.set(workspaceId, { at: Date.now(), ctx })
  return ctx
}
