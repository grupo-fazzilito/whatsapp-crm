import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { createTranslator } from '@/i18n/translate'
import { industryLabel, resolveIndustry, type ModuleKey } from '@/lib/industries'
import { addDays, safeTimeZone, zonedNow } from '@/lib/ai/time'
import type { Workspace } from '@/lib/workspace/types'

/**
 * GET  — campaign templates for the workspace's industry and language.
 * POST — render a template and resolve its audience segment, ready to be
 *        sent through the broadcast flow:
 *        {template_id, variables?, contact_ids?, segment_filter?: 'all'|'recent'|'inactive'}
 */

interface TemplateDef {
  id: string
  category: 'engagement' | 'marketing' | 'bookings' | 'preventive' | 'awareness' | 'care'
  /** Only offered when this module is on for the workspace. */
  module?: ModuleKey
  variables: string[]
}

const TEMPLATES: TemplateDef[] = [
  { id: 'reactivation', category: 'engagement', variables: ['name', 'offer_text'] },
  { id: 'promotion', category: 'marketing', variables: ['name', 'title', 'details', 'valid_until'] },
  { id: 'new_service', category: 'marketing', module: 'services', variables: ['name', 'service_name', 'service_description', 'price'] },
  { id: 'availability', category: 'bookings', module: 'bookings', variables: ['name', 'available_dates'] },
  { id: 'tip', category: 'engagement', variables: ['name', 'tip_title', 'tip_content'] },
  { id: 'vaccination', category: 'preventive', module: 'triage', variables: ['name', 'vaccine_name', 'available_dates'] },
  { id: 'checkup', category: 'preventive', module: 'triage', variables: ['name', 'offer_text'] },
  { id: 'seasonal_alert', category: 'awareness', module: 'triage', variables: ['name', 'season', 'prevention_tips', 'symptoms_list'] },
  { id: 'prescription_refill', category: 'care', module: 'triage', variables: ['name', 'medication_name', 'last_date'] },
]

/** Values filled from the business profile (callers may override). */
function autoVariables(ws: Workspace): Record<string, string> {
  const locale = ws.locale === 'en' ? 'en' : 'es'
  const lower = (s: string) => s.toLocaleLowerCase(locale)
  return {
    business_name: ws.name,
    business_phone: ws.phone ?? '',
    business_address: [ws.address, ws.city].filter(Boolean).join(', '),
    booking: lower(industryLabel(ws.industry, 'booking', locale, ws.settings)),
    staff: lower(industryLabel(ws.industry, 'staff', locale, ws.settings)),
  }
}

function templatesFor(ws: Workspace) {
  const t = createTranslator(ws.locale === 'en' ? 'en' : 'es')
  const { modules } = resolveIndustry(ws.industry, ws.settings)
  return TEMPLATES.filter((d) => !d.module || modules[d.module]).map((d) => ({
    id: d.id,
    category: d.category,
    name: t(`bookings.campaigns.${d.id}.name`),
    description: t(`bookings.campaigns.${d.id}.description`),
    template: t(`bookings.campaigns.${d.id}.body`),
    variables: d.variables,
    defaults: autoVariables(ws),
  }))
}

export async function GET() {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  return NextResponse.json({ templates: templatesFor(guard.ctx.workspace) })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const { workspace: ws, db } = guard.ctx

  const body = await request.json().catch(() => null)
  if (!body || typeof body.template_id !== 'string') {
    return NextResponse.json({ error: 'template_id is required' }, { status: 400 })
  }
  const template = templatesFor(ws).find((t) => t.id === body.template_id)
  if (!template) return NextResponse.json({ error: 'Template not found' }, { status: 404 })

  const values: Record<string, string> = { ...template.defaults }
  for (const [k, v] of Object.entries((body.variables ?? {}) as Record<string, unknown>)) {
    if ((typeof v === 'string' && v.trim()) || typeof v === 'number') values[k] = String(v)
  }
  // {{name}} is per recipient: unless given, leave it for the broadcast to fill.
  const rendered = template.template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => values[k] ?? (k === 'name' ? m : ''))

  const segment: string = ['recent', 'inactive'].includes(body.segment_filter) ? body.segment_filter : 'all'
  let targets: string[] = Array.isArray(body.contact_ids) ? body.contact_ids.filter((x: unknown) => typeof x === 'string') : []

  if (targets.length > 0) {
    // Only contacts of this workspace.
    // (A malformed id failed the whole PostgREST query: no targets.)
    const wanted = targets.slice(0, 1000)
    const data = wanted.every(isUuid) ? await db.contacts.findMany({ select: { id: true }, where: { id: { in: wanted } } }) : []
    targets = data.map((c) => c.id)
  } else {
    const today = zonedNow(safeTimeZone(ws.timezone)).date
    const bookedSince = async (days: number) => {
      const data = await db.bookings.findMany({
        select: { contact_id: true },
        where: { booking_date: { gte: addDays(today, -days) } }, // contact_id is NOT NULL
      })
      return new Set(data.map((b) => b.contact_id as string))
    }
    if (segment === 'recent') {
      targets = [...(await bookedSince(90))]
    } else {
      const all = await db.contacts.findMany({ select: { id: true } })
      const ids = all.map((c) => c.id)
      if (segment === 'inactive') {
        const recent = await bookedSince(180)
        targets = ids.filter((id) => !recent.has(id))
      } else {
        targets = ids
      }
    }
  }

  return NextResponse.json({
    message: 'Campaign prepared',
    template_id: template.id,
    template_name: template.name,
    rendered_message: rendered,
    target_count: targets.length,
    target_contact_ids: targets.slice(0, 500),
    segment_filter: segment,
  })
}
