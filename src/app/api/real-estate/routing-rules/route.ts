import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { sanitizeConditions } from '@/lib/real-estate/leads/routing'
import { RULE_SELECT, ruleError, ruleTarget } from '@/lib/real-estate/leads/routing-api'

/**
 * GET  /api/real-estate/routing-rules → { rules } (by priority)
 * POST /api/real-estate/routing-rules (admins)
 *   { name, conditions?, team_id? | user_id?, active? } → { rule } (added last)
 * PUT  /api/real-estate/routing-rules (admins) { ids: [...] } — new order. → { ok }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const { data, error } = await supabase
    .from('real_estate_routing_rules')
    .select(RULE_SELECT)
    .eq('workspace_id', workspace.id)
    .order('priority')
    .order('created_at')
  if (error) {
    console.error('[routing-rules] list failed:', error.message)
    return NextResponse.json({ error: 'Failed to load rules' }, { status: 500 })
  }
  return NextResponse.json({ rules: data ?? [] })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const target = ruleTarget(body)
  if (!target) return NextResponse.json({ error: 'target_required' }, { status: 400 })

  const { data: last } = await supabase
    .from('real_estate_routing_rules')
    .select('priority')
    .eq('workspace_id', workspace.id)
    .order('priority', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data, error } = await supabase
    .from('real_estate_routing_rules')
    .insert({
      workspace_id: workspace.id,
      name,
      priority: ((last?.priority as number | undefined) ?? -1) + 1,
      conditions: sanitizeConditions(body.conditions),
      ...target,
      active: body.active !== false,
    })
    .select(RULE_SELECT)
    .single()
  if (error || !data) return ruleError(error?.code, error?.message)
  return NextResponse.json({ rule: data })
}

export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === 'string' && isUuid(x)) : []
  if (!ids.length) return NextResponse.json({ error: 'ids_required' }, { status: 400 })
  for (const [i, id] of ids.entries()) {
    const { error } = await supabase.from('real_estate_routing_rules').update({ priority: i }).eq('id', id).eq('workspace_id', workspace.id)
    if (error) return ruleError(error.code, error.message)
  }
  return NextResponse.json({ ok: true })
}
