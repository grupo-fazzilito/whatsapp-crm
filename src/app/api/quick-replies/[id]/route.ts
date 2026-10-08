import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid } from '@/lib/workspace/constants'
import { parseQuickReplyInput } from '@/lib/inbox/quick-replies'

/**
 * PATCH  /api/quick-replies/[id] { shortcut?, title?, body?, attachments?, is_shared? }
 * DELETE /api/quick-replies/[id]
 * Authors manage their personal replies; admins manage shared ones (RLS
 * enforces it too). Only admins can make a reply shared.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, workspace, role } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = parseQuickReplyInput(body, workspace.id, true)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (parsed.value.is_shared === true && !hasRole(role, 'admin')) {
    return NextResponse.json({ error: 'only_admins_share' }, { status: 403 })
  }
  if (Object.keys(parsed.value).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const { data, error } = await supabase
    .from('quick_replies')
    .update(parsed.value)
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .select('*')
    .maybeSingle()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'shortcut_taken' }, { status: 409 })
    console.error('[quick-replies] update failed:', error.message)
    return NextResponse.json({ error: 'Failed to update quick reply' }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ quick_reply: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const { data, error } = await supabase
    .from('quick_replies')
    .delete()
    .eq('id', id)
    .eq('workspace_id', workspace.id)
    .select('id, attachments')
  if (error) {
    console.error('[quick-replies] delete failed:', error.message)
    return NextResponse.json({ error: 'Failed to delete quick reply' }, { status: 500 })
  }
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Drop the stored files too (best effort).
  const paths = ((data[0].attachments ?? []) as { path?: string }[])
    .map((a) => a.path)
    .filter((p): p is string => typeof p === 'string' && p.startsWith(`${workspace.id}/quick-replies/`))
  if (paths.length) {
    const { error: rmErr } = await supabase.storage.from('attachments').remove(paths)
    if (rmErr) console.error('[quick-replies] file cleanup failed:', rmErr.message)
  }
  return NextResponse.json({ ok: true })
}
