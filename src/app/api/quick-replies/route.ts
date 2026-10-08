import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole } from '@/lib/workspace/constants'
import { parseQuickReplyInput } from '@/lib/inbox/quick-replies'

/**
 * GET  /api/quick-replies → { quick_replies } (shared + the caller's own)
 * POST /api/quick-replies { shortcut, title, body, attachments?, is_shared? }
 *   Members create personal replies; only admins create shared ones.
 *   → { quick_reply } | 409 when the shortcut is taken in the workspace
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const { data, error } = await supabase
    .from('quick_replies')
    .select('*')
    .eq('workspace_id', workspace.id)
    .order('shortcut', { ascending: true })
  if (error) {
    console.error('[quick-replies] list failed:', error.message)
    return NextResponse.json({ error: 'Failed to load quick replies' }, { status: 500 })
  }
  return NextResponse.json({ quick_replies: data ?? [] })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, user, workspace, role } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = parseQuickReplyInput(body, workspace.id, false)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const isAdmin = hasRole(role, 'admin')
  // Shared by default for admins, personal for agents.
  const isShared = 'is_shared' in parsed.value ? parsed.value.is_shared === true : isAdmin
  if (isShared && !isAdmin) return NextResponse.json({ error: 'only_admins_share' }, { status: 403 })

  const { data, error } = await supabase
    .from('quick_replies')
    .insert({ ...parsed.value, is_shared: isShared, workspace_id: workspace.id, created_by: user.id })
    .select('*')
    .single()
  if (error) {
    if (error.code === '23505') return NextResponse.json({ error: 'shortcut_taken' }, { status: 409 })
    console.error('[quick-replies] create failed:', error.message)
    return NextResponse.json({ error: 'Failed to create quick reply' }, { status: 500 })
  }
  return NextResponse.json({ quick_reply: data })
}
