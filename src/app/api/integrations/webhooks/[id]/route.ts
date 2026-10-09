import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { normalizeEvents } from '@/lib/webhooks/events'
import { checkWebhookUrl, defaultUrlPolicy } from '@/lib/webhooks/ssrf'

type Ctx = { params: Promise<{ id: string }> }

/** Columns of ENDPOINT_FIELDS (secrets are never returned). */
const ENDPOINT_SELECT = {
  id: true,
  url: true,
  description: true,
  events: true,
  active: true,
  failure_count: true,
  disabled_at: true,
  disabled_reason: true,
  last_success_at: true,
  last_failure_at: true,
  created_at: true,
  updated_at: true,
} as const

/** PATCH {url?, description?, events?, active?} — re-enabling resets the failure counter. */
export async function PATCH(request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.url === 'string') {
    const check = checkWebhookUrl(body.url, defaultUrlPolicy())
    if (!check.ok) return NextResponse.json({ error: `url_${check.reason}` }, { status: 400 })
    patch.url = check.url.toString()
  }
  if ('description' in body) patch.description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) || null : null
  if ('events' in body) {
    const events = normalizeEvents(body.events)
    if (!events.length) return NextResponse.json({ error: 'events_required' }, { status: 400 })
    patch.events = events
  }
  if (typeof body.active === 'boolean') {
    patch.active = body.active
    if (body.active) Object.assign(patch, { failure_count: 0, disabled_at: null, disabled_reason: null })
    else Object.assign(patch, { disabled_at: new Date().toISOString(), disabled_reason: 'manual' })
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })

  let data
  try {
    const rows = await guard.ctx.db.webhook_endpoints.updateManyAndReturn({
      where: { id, workspace_id: guard.ctx.workspace.id },
      data: patch,
      select: ENDPOINT_SELECT,
    })
    data = rows[0] ?? null
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ endpoint: data })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  let deleted: number
  try {
    ;({ count: deleted } = await guard.ctx.db.webhook_endpoints.deleteMany({
      where: { id, workspace_id: guard.ctx.workspace.id },
    }))
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
  if (!deleted) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
