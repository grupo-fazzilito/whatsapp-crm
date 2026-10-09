import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { checkRateLimit, rateLimitResponse, RATE_LIMITS } from '@/lib/rate-limit'
import { extractMentions, type MentionCandidate } from '@/lib/inbox/mentions'
import { memberNames, notify } from '@/lib/inbox/server'
import { notificationText } from '@/lib/inbox/texts'

const MAX_NOTE = 4000

/**
 * POST /api/conversations/[id]/notes { text, mentions?: string[] }
 * Internal note: stored as a message with is_internal = true. It never
 * goes through a channel adapter, never reaches the web widget or the AI,
 * and doesn't change the conversation preview (only updated_at).
 * @mentioned members (ids sent by the composer, plus any "@Full Name" in
 * the text) get a notification. → { message }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx

  const limit = checkRateLimit(`note:${user.id}`, RATE_LIMITS.send)
  if (!limit.success) return rateLimitResponse(limit)

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const text = typeof body?.text === 'string' ? body.text.replace(/\u0000/g, '').trim() : ''
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 })
  if (text.length > MAX_NOTE) return NextResponse.json({ error: `Note is too long (max ${MAX_NOTE})` }, { status: 413 })

  const conv = await db.conversations.findFirst({ select: { id: true }, where: { id, workspace_id: workspace.id } })
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  let message
  try {
    message = await db.messages.create({
      data: {
        workspace_id: workspace.id,
        conversation_id: id,
        sender_type: 'agent',
        sender_id: user.id,
        content_type: 'text',
        content_text: text,
        status: 'delivered',
        is_internal: true,
        metadata: {},
      },
    })
  } catch (error) {
    console.error('[notes] insert failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to save note' }, { status: 500 })
  }
  await db.conversations
    .updateMany({ where: { id, workspace_id: workspace.id }, data: { updated_at: new Date().toISOString() } })
    .catch(() => null)

  // Mentions: only active members of this workspace.
  const members = await db.workspace_members
    .findMany({ select: { user_id: true }, where: { workspace_id: workspace.id, status: 'active' } })
    .catch(() => null)
  const memberIds = (members ?? []).map((m) => m.user_id)
  const names = await memberNames([...memberIds, user.id])
  const requested = Array.isArray(body?.mentions) ? body!.mentions.filter((x): x is string => typeof x === 'string') : []
  const candidates: MentionCandidate[] = memberIds.map((uid) => ({ userId: uid, name: names.get(uid) ?? '' }))
  const mentioned = [
    ...new Set([...requested.filter((uid) => memberIds.includes(uid)), ...extractMentions(text, candidates)]),
  ].filter((uid) => uid !== user.id)

  if (mentioned.length) {
    const actor = names.get(user.id) || notificationText(workspace.locale, 'someone')
    await notify(
      mentioned.map((uid) => ({
        workspaceId: workspace.id,
        userId: uid,
        type: 'mention' as const,
        title: notificationText(workspace.locale, 'mention', { actor }),
        body: text,
        conversationId: id,
        actorId: user.id,
      })),
    )
  }

  return NextResponse.json({ message, mentioned })
}
