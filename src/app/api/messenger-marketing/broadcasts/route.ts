import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { cardIssues, parseCard } from '@/lib/messenger-marketing/model'
import { createMessengerBroadcast } from '@/lib/messenger-marketing/server'

/**
 * POST { name, card, tag_ids?, budget?, scheduled_at? } (admins) → { id, recipients }.
 * Sends a Messenger card to every subscriber that can get one now (Meta: one every 12 h).
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 120) : ''
  const card = parseCard(body?.card)
  if (!name || !card) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const issues = cardIssues(card)
  if (issues.length) return NextResponse.json({ error: 'issues', issues }, { status: 400 })
  const tagIds = Array.isArray(body?.tag_ids) ? body.tag_ids.filter((x): x is string => typeof x === 'string' && isUuid(x)).slice(0, 100) : []
  const budget = body?.budget == null || body.budget === '' ? null : Number(body.budget)
  if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 1_000_000)) return NextResponse.json({ error: 'invalid_budget' }, { status: 400 })
  let scheduledAt: Date | null = null
  if (body?.scheduled_at) {
    scheduledAt = new Date(String(body.scheduled_at))
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() > Date.now() + 30 * 86_400_000) return NextResponse.json({ error: 'invalid_date' }, { status: 400 })
  }
  const r = await createMessengerBroadcast(guard.ctx.workspace.id, guard.ctx.user.id, { name, card, audience: { tagIds }, budget: budget === null ? null : Math.round(budget * 100) / 100, scheduledAt })
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'empty' ? 400 : 409 })
  return NextResponse.json({ id: r.id, recipients: r.recipients }, { status: 201 })
}
