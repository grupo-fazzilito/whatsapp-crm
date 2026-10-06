import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { workspaceCookieOptions } from '@/lib/workspace/context'
import { WORKSPACE_COOKIE } from '@/lib/workspace/constants'
import { acceptInvitation, findPendingInvitation } from '@/lib/workspace/invitations'

type Params = { params: Promise<{ token: string }> }

// GET — public preview of an invitation (workspace, email, role).
export async function GET(_req: NextRequest, { params }: Params) {
  const { token } = await params
  const inv = await findPendingInvitation(token)
  if (!inv) return NextResponse.json({ error: 'Invitation not found or expired' }, { status: 404 })
  return NextResponse.json({ workspace_name: inv.workspace_name, email: inv.email, role: inv.role })
}

// POST — signed-in user accepts. The account email must match the invite.
export async function POST(_req: NextRequest, { params }: Params) {
  const { token } = await params
  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const inv = await findPendingInvitation(token)
  if (!inv) return NextResponse.json({ error: 'Invitation not found or expired' }, { status: 404 })
  if ((user.email ?? '').toLowerCase() !== inv.email.toLowerCase()) {
    return NextResponse.json({ error: `This invitation is for ${inv.email}` }, { status: 403 })
  }

  await acceptInvitation(inv, user.id)
  const res = NextResponse.json({ ok: true, workspace_id: inv.workspace_id })
  res.cookies.set(WORKSPACE_COOKIE, inv.workspace_id, workspaceCookieOptions())
  return res
}
