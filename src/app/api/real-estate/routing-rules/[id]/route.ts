import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { sanitizeConditions } from '@/lib/real-estate/leads/routing'
import { ruleError, ruleTarget } from '@/lib/real-estate/leads/routing-api'
import { pgErrorCode } from '@/lib/db/errors'
import type { Prisma } from '@/generated/prisma/client'

// RULE_SELECT ('id, workspace_id, name, priority, conditions, team_id, user_id, active, created_at, updated_at') for Prisma.
const RULE_FIELDS = {
  id: true,
  workspace_id: true,
  name: true,
  priority: true,
  conditions: true,
  team_id: true,
  user_id: true,
  active: true,
  created_at: true,
  updated_at: true,
} as const

/** ruleError() for a Prisma failure (Postgres code + message, as supabase-js gave them). */
function writeError(e: unknown) {
  return ruleError(pgErrorCode(e) ?? (e as { code?: string })?.code, e instanceof Error ? e.message : String(e))
}

/**
 * PATCH  /api/real-estate/routing-rules/[id] (admins)
 *   { name?, conditions?, team_id? | user_id?, active?, priority? } → { rule }
 * DELETE /api/real-estate/routing-rules/[id] (admins) → { ok }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
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

  let data
  try {
    const rows = await db.real_estate_routing_rules.updateManyAndReturn({
      where: { id },
      data: update as Prisma.real_estate_routing_rulesUncheckedUpdateManyInput,
      select: RULE_FIELDS,
    })
    data = rows[0] ?? null
  } catch (e) {
    return writeError(e)
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ rule: data })
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    await db.real_estate_routing_rules.deleteMany({ where: { id } })
  } catch (e) {
    return writeError(e)
  }
  return NextResponse.json({ ok: true })
}
