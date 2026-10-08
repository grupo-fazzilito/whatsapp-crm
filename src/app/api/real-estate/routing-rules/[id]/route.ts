import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { sanitizeConditions } from '@/lib/real-estate/leads/routing'
import { RULE_SELECT, ruleError, ruleTarget } from '@/lib/real-estate/leads/routing-api'

/**
 * PATCH  /api/real-estate/routing-rules/[id] (admins)
 *   { name?, conditions?, team_id? | user_id?, active?, priority? } → { rule }
 * DELETE /api/real-estate/routing-rules/[id] (admins) → { ok }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    update.name = name
  }
  if ('conditions' in body) update.conditions = sanitizeConditions(body.conditions)
  if ('active' in body) update.active = body.active === true
  if ('priority' in body && typeof body.priority === 'number' && Number.isInteger(body.priority)) update.priority = body.priority
  if ('team_id' in body || 'user_id' in body) {
    const target = ruleTarget(body)
    if (!target) return NextResponse.json({ error: 'target_required' }, { status: 400 })
    Object.assign(update, target)
  }
  if (!Object.keys(update).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await supabase
    .from('real_estate_routing_rules')
    .update(update)
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .select(RULE_SELECT)
    .maybeSingle()
  if (error) return ruleError(error.code, error.message)
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ rule: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const { error } = await supabase.from('real_estate_routing_rules').delete().eq('id', id).eq('workspace_id', workspace.id)
  if (error) return ruleError(error.code, error.message)
  return NextResponse.json({ ok: true })
}
