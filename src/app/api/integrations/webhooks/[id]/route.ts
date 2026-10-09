import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ENDPOINT_FIELDS, normalizeEvents } from '@/lib/webhooks/events'
import { checkWebhookUrl, defaultUrlPolicy } from '@/lib/webhooks/ssrf'

type Ctx = { params: Promise<{ id: string }> }

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

  const { data, error } = await supabaseAdmin()
    .from('webhook_endpoints')
    .update(patch)
    .eq('id', id)
    .eq('workspace_id', guard.ctx.workspace.id)
    .select(ENDPOINT_FIELDS)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ endpoint: data })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { data, error } = await supabaseAdmin()
    .from('webhook_endpoints')
    .delete()
    .eq('id', id)
    .eq('workspace_id', guard.ctx.workspace.id)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ deleted: true })
}
