import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listMemberships, workspaceCookieOptions } from '@/lib/workspace/context'
import { WORKSPACE_COOKIE, isUuid } from '@/lib/workspace/constants'

export async function POST(req: NextRequest) {
  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { workspaceId } = await req.json().catch(() => ({}))
  if (!isUuid(workspaceId)) return NextResponse.json({ error: 'Invalid workspace' }, { status: 400 })

  const memberships = await listMemberships(user.id)
  if (!memberships.some((m) => m.workspace.id === workspaceId)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(WORKSPACE_COOKIE, workspaceId, workspaceCookieOptions())
  return res
}
