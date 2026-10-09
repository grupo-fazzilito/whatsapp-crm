import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole } from '@/lib/workspace/constants'
import { parseQuickReplyInput } from '@/lib/inbox/quick-replies'
import { isPrismaError } from '@/lib/db/errors'

/**
 * GET  /api/quick-replies → { quick_replies } (shared + the caller's own)
 * POST /api/quick-replies { shortcut, title, body, attachments?, is_shared? }
 *   Members create personal replies; only admins create shared ones.
 *   → { quick_reply } | 409 when the shortcut is taken in the workspace
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx
  let data
  try {
    // Shared replies plus the caller's personal ones (was RLS qr_read).
    data = await db.quick_replies.findMany({
      where: { workspace_id: workspace.id, OR: [{ is_shared: true }, { created_by: user.id }] },
      orderBy: { shortcut: 'asc' },
    })
  } catch (err) {
    console.error('[quick-replies] list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load quick replies' }, { status: 500 })
  }
  return NextResponse.json({ quick_replies: data })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace, role } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = parseQuickReplyInput(body, workspace.id, false)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })

  const isAdmin = hasRole(role, 'admin')
  // Shared by default for admins, personal for agents.
  const isShared = 'is_shared' in parsed.value ? parsed.value.is_shared === true : isAdmin
  if (isShared && !isAdmin) return NextResponse.json({ error: 'only_admins_share' }, { status: 403 })

  const { shortcut, title, body: text, attachments } = parsed.value as { shortcut: string; title: string; body: string; attachments: Prisma.InputJsonValue }
  let data
  try {
    data = await db.quick_replies.create({
      data: { shortcut, title, body: text, attachments, is_shared: isShared, workspace_id: workspace.id, created_by: user.id },
    })
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return NextResponse.json({ error: 'shortcut_taken' }, { status: 409 })
    console.error('[quick-replies] create failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to create quick reply' }, { status: 500 })
  }
  return NextResponse.json({ quick_reply: data })
}
