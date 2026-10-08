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
  const { supabase, user, workspace, role } = guard.ctx

  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid conversation id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Conversation not found' }, { status: 404 })

  let tag: { id: string; name: string; color: string } | null = null
  if (typeof body.tag_id === 'string') {
    if (!isUuid(body.tag_id)) return NextResponse.json({ error: 'Invalid tag id' }, { status: 400 })
    const { data } = await supabase
      .from('tags')
      .select('id, name, color')
      .eq('id', body.tag_id)
      .eq('workspace_id', workspace.id)
      .maybeSingle()
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
    const { data: existing } = await supabase
      .from('tags')
      .select('id, name, color')
      .eq('workspace_id', workspace.id)
      .ilike('name', name.replace(/[%_\\]/g, (c) => `\\${c}`))
      .limit(1)
      .maybeSingle()
    if (existing) {
      tag = existing
    } else {
      const { data: created, error } = await supabase
        .from('tags')
        .insert({ workspace_id: workspace.id, user_id: user.id, name, color })
        .select('id, name, color')
        .single()
      if (error || !created) {
        console.error('[conversation tags] tag create failed:', error?.message)
        return NextResponse.json({ error: 'Failed to create tag' }, { status: 500 })
      }
      tag = created
    }
  } else {
    return NextResponse.json({ error: 'tag_id or name is required' }, { status: 400 })
  }

  const { data: existingLink } = await supabase
    .from('conversation_tags')
    .select('id, tag_id')
    .eq('conversation_id', id)
    .eq('tag_id', tag!.id)
    .maybeSingle()
  if (existingLink) return NextResponse.json({ conversation_tag: existingLink, tag })

  const { data: link, error } = await supabase
    .from('conversation_tags')
    .insert({ workspace_id: workspace.id, conversation_id: id, tag_id: tag!.id, created_by: user.id })
    .select('id, tag_id')
    .single()
  if (error || !link) {
    console.error('[conversation tags] apply failed:', error?.message)
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
  const { supabase, user, workspace } = guard.ctx

  const { id } = await params
  const tagId = new URL(request.url).searchParams.get('tag_id')
  if (!isUuid(id) || !isUuid(tagId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { data: removed, error } = await supabase
    .from('conversation_tags')
    .delete()
    .eq('conversation_id', id)
    .eq('tag_id', tagId)
    .eq('workspace_id', workspace.id)
    .select('id')
  if (error) {
    console.error('[conversation tags] remove failed:', error.message)
    return NextResponse.json({ error: 'Failed to remove tag' }, { status: 500 })
  }
  if (removed?.length) {
    const { data: tag } = await supabase.from('tags').select('name, color').eq('id', tagId).maybeSingle()
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
