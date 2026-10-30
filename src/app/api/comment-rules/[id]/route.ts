import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseRuleInput } from '@/lib/comments/model'
import { channelAllowed } from '@/lib/comments/server'

type Ctx = { params: Promise<{ id: string }> }

/** PATCH /api/comment-rules/:id — `{ enabled }` alone toggles the rule; anything else replaces it. */
export async function PATCH(request: Request, { params }: Ctx) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const now = new Date()
  if (Object.keys(body).length === 1 && typeof body.enabled === 'boolean') {
    const r = await db.comment_rules.updateMany({ where: { id }, data: { enabled: body.enabled, updated_at: now } })
    return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const parsed = parseRuleInput(body)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { rule } = parsed
  if (rule.channel_id && (!isUuid(rule.channel_id) || !(await channelAllowed(workspace.id, rule.channel_id)))) {
    return NextResponse.json({ error: 'channel' }, { status: 400 })
  }
  const r = await db.comment_rules.updateMany({
    where: { id },
    data: {
      ...rule,
      post_id: rule.channel_id ? rule.post_id : null,
      // Saving it with an account (or "every account") attaches it again.
      detached_channel_type: null,
      detached_external_id: null,
      updated_at: now,
    },
  })
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/** DELETE /api/comment-rules/:id — the log of answered comments stays. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const r = await guard.ctx.db.comment_rules.deleteMany({ where: { id } })
  return r.count ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
