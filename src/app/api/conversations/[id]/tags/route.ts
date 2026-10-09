import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid } from '@/lib/workspace/constants'
import { recordEvent } from '@/lib/inbox/server'

const COLOR_RE = /^#[0-9a-f]{6}$/i

/**
 * POST /api/conversations/[id]/tags
 *   { tag_id }                → apply an existing workspace tag (any member)
 *   { name, color? }          → create the tag first (admins only), then apply
 * → { conversation_tag: {id, tag_id}, tag }
 *
 * DELETE /api/conversations/[id]/tags?tag_id=<uuid> → { ok: true }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace, role } = guard.ctx

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const conv = await db.conversations.findFirst({ select: { id: true }, where: { id, workspace_id: workspace.id } })
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  let tag: { id: string; name: string; color: string } | null = null
  if (typeof body.tag_id === 'string') {
    if (!isUuid(body.tag_id)) return NextResponse.json({ error: 'Invalid tag id' }, { status: 400 })
    const data = await db.tags.findFirst({ select: { id: true, name: true, color: true }, where: { id: body.tag_id, workspace_id: workspace.id } })
    if (!data) return NextResponse.json({ error: 'Tag not found' }, { status: 404 })
    tag = data
  } else if (typeof body.name === 'string') {
    if (!hasRole(role, 'admin')) {
      return NextResponse.json({ error: 'Only admins can create tags' }, { status: 403 })
    }
    const name = body.name.trim().slice(0, 50)
    if (!name) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
    const color = typeof body.color === 'string' && COLOR_RE.test(body.color) ? body.color : '#3b82f6'
    // Reuse a tag with the same name instead of duplicating it.
    const existing = await db.tags.findFirst({
      select: { id: true, name: true, color: true },
      where: { workspace_id: workspace.id, name: { equals: name, mode: 'insensitive' } },
    })
    if (existing) {
      tag = existing
    } else {
      try {
        tag = await db.tags.create({
          data: { workspace_id: workspace.id, user_id: user.id, name, color },
          select: { id: true, name: true, color: true },
        })
      } catch (error) {
        console.error('[conversation tags] tag create failed:', error instanceof Error ? error.message : error)
        return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 })
      }
    }
  } else {
    return NextResponse.json({ error: 'tag_id or name is required' }, { status: 400 })
  }

  const existingLink = await db.conversation_tags.findFirst({ select: { id: true, tag_id: true }, where: { conversation_id: id, tag_id: tag!.id } })
  if (existingLink) return NextResponse.json({ conversation_tag: existingLink, tag })

  let link: { id: string; tag_id: string }
  try {
    link = await db.conversation_tags.create({
      data: { workspace_id: workspace.id, conversation_id: id, tag_id: tag!.id, created_by: user.id },
      select: { id: true, tag_id: true },
    })
  } catch (error) {
    console.error('[conversation tags] apply failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to apply tag' }, { status: 500 })
  }

  await recordEvent({
    workspaceId: workspace.id,
    conversationId: id,
    type: 'tag_added',
    fromUser: user.id,
    data: { tag_id: tag!.id, tag_name: tag!.name, color: tag!.color },
  })
  return NextResponse.json({ conversation_tag: link, tag })
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx

  const { id } = await params
  const tagId = new URL(request.url).searchParams.get('tag_id')
  if (!isUuid(id) || !isUuid(tagId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  let removed: number
  try {
    removed = (await db.conversation_tags.deleteMany({ where: { conversation_id: id, tag_id: tagId, workspace_id: workspace.id } })).count
  } catch (error) {
    console.error('[conversation tags] remove failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to remove tag' }, { status: 500 })
  }
  if (removed) {
    const tag = await db.tags.findFirst({ select: { name: true, color: true }, where: { id: tagId } })
    await recordEvent({
      workspaceId: workspace.id,
      conversationId: id,
      type: 'tag_removed',
      fromUser: user.id,
      data: { tag_id: tagId, tag_name: tag?.name ?? null, color: tag?.color ?? null },
    })
  }
  return NextResponse.json({ ok: true })
}
