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
 * GET  /api/real-estate/routing-rules → { rules } (by priority)
 * POST /api/real-estate/routing-rules (admins)
 *   { name, conditions?, team_id? | user_id?, active? } → { rule } (added last)
 * PUT  /api/real-estate/routing-rules (admins) { ids: [...] } — new order. → { ok }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  try {
    const data = await db.real_estate_routing_rules.findMany({ select: RULE_FIELDS, orderBy: [{ priority: 'asc' }, { created_at: 'asc' }] })
    return NextResponse.json({ rules: data })
  } catch (e) {
    console.error('[routing-rules] list failed:', e instanceof Error ? e.message : e)
    return NextResponse.json({ error: 'Failed to load rules' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : ''
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const target = ruleTarget(body)
  if (!target) return NextResponse.json({ error: 'target_required' }, { status: 400 })

  const last = await db.real_estate_routing_rules
    .findFirst({ select: { priority: true }, orderBy: { priority: 'desc' } })
    .catch(() => null)
  try {
    const data = await db.real_estate_routing_rules.create({
      data: {
        workspace_id: workspace.id,
        name,
        priority: (last?.priority ?? -1) + 1,
        conditions: sanitizeConditions(body.conditions) as Prisma.InputJsonValue,
        ...target,
        active: body.active !== false,
      },
      select: RULE_FIELDS,
    })
    return NextResponse.json({ rule: data })
  } catch (e) {
    return writeError(e)
  }
}

export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === 'string' && isUuid(x)) : []
  if (!ids.length) return NextResponse.json({ error: 'ids_required' }, { status: 400 })
  for (const [i, id] of ids.entries()) {
    try {
      await db.real_estate_routing_rules.updateMany({ where: { id }, data: { priority: i } })
    } catch (e) {
      return writeError(e)
    }
  }
  return NextResponse.json({ ok: true })
}
