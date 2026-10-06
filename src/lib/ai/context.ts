import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { addDays, safeTimeZone, zonedNow } from './time'
import type { Workspace } from '@/lib/workspace/types'
import type { AiAgentRow } from './types'
import type { BookingRow, BusinessException, BusinessHoursRow, StaffRow } from './slots'

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

  const db = supabaseAdmin()
  const { data: workspace } = await db.from('workspaces').select('*').eq('id', workspaceId).maybeSingle()
  if (!workspace) return null
  const timeZone = safeTimeZone(workspace.timezone)
  const today = zonedNow(timeZone).date

  const [hours, staff, links, services, faqs, agents, bookings] = await Promise.all([
    db.from('business_hours').select('*').eq('workspace_id', workspaceId),
    db.from('staff').select('*').eq('workspace_id', workspaceId).eq('is_active', true).order('name'),
    db.from('staff_services').select('staff_id, service_id').eq('workspace_id', workspaceId),
    db.from('services').select('*').eq('workspace_id', workspaceId).eq('is_active', true).order('name'),
    db.from('faqs').select('id, question, answer, keywords, ai_agent_ids').eq('workspace_id', workspaceId),
    db.from('ai_agents').select('*').eq('workspace_id', workspaceId).eq('enabled', true),
    db
      .from('bookings')
      .select('id, staff_id, booking_date, booking_time, duration_minutes, status, party_size')
      .eq('workspace_id', workspaceId)
      .gte('booking_date', today)
      .lte('booking_date', addDays(today, BOOKING_HORIZON_DAYS))
      .in('status', ['pending', 'confirmed']),
  ])

  const servicesByStaff = new Map<string, string[]>()
  for (const l of links.data ?? []) {
    servicesByStaff.set(l.staff_id, [...(servicesByStaff.get(l.staff_id) ?? []), l.service_id])
  }

  const ctx: BusinessContext = {
    workspace: workspace as Workspace,
    timeZone,
    hours: (hours.data ?? []) as BusinessHoursRow[],
    exceptions: ((workspace as { date_exceptions?: BusinessException[] }).date_exceptions ?? []) as BusinessException[],
    staff: (staff.data ?? []).map((s) => ({ ...s, service_ids: servicesByStaff.get(s.id) ?? [] })) as StaffFull[],
    services: (services.data ?? []) as ServiceRow[],
    faqs: (faqs.data ?? []) as FaqRow[],
    agents: (agents.data ?? []) as AiAgentRow[],
    bookings: (bookings.data ?? []) as BusinessContext['bookings'],
  }
  cache.set(workspaceId, { at: Date.now(), ctx })
  return ctx
}
