import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseRuleInput } from '@/lib/comments/model'
import { channelAllowed, commentChannels, listRules, recentReplies } from '@/lib/comments/server'

/** GET /api/comment-rules — rules, the accounts they can use and the latest answered comments. */
export async function GET() {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const [rules, channels, replies] = await Promise.all([listRules(ws), commentChannels(ws), recentReplies(ws)])
  return NextResponse.json({ rules, channels, replies })
}

/** POST /api/comment-rules — new rule (admins). */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx
  const parsed = parseRuleInput(await request.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { rule } = parsed
  if (rule.channel_id && (!isUuid(rule.channel_id) || !(await channelAllowed(workspace.id, rule.channel_id)))) {
    return NextResponse.json({ error: 'channel' }, { status: 400 })
  }
  const last = await db.comment_rules.findFirst({ orderBy: { position: 'desc' }, select: { position: true } })
  const created = await db.comment_rules.create({
    data: { ...rule, post_id: rule.channel_id ? rule.post_id : null, workspace_id: workspace.id, position: (last?.position ?? -1) + 1, created_by: user.id },
  })
  return NextResponse.json({ rule: created }, { status: 201 })
}
