import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { connectPage } from '@/lib/social/server'
import { unseal } from '@/app/api/channels/_lib/shared'
import { SOCIAL_COOKIE, SOCIAL_COOKIE_PATH, type SocialCandidates } from './shared'

function read(request: NextRequest, ws: string, uid: string): SocialCandidates | null {
  const data = unseal<SocialCandidates>(request.cookies.get(SOCIAL_COOKIE)?.value)
  return data && data.exp > Date.now() && data.ws === ws && data.uid === uid ? data : null
}

/** GET → { pages: [{ id, name, picture, instagram }] } (no tokens). */
export async function GET(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const data = read(request, guard.ctx.workspace.id, guard.ctx.user.id)
  return NextResponse.json({
    pages: (data?.pages ?? []).map((p) => ({ id: p.id, name: p.name, picture: p.picture, instagram: p.ig ? { username: p.ig.username } : null })),
  })
}

/** POST { page_id } → connects that page (and its Instagram account). */
export async function POST(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const data = read(request, guard.ctx.workspace.id, guard.ctx.user.id)
  const body = (await request.json().catch(() => null)) as { page_id?: unknown } | null
  const page = data?.pages.find((p) => p.id === body?.page_id)
  if (!page) return NextResponse.json({ error: 'expired' }, { status: 410 })
  await connectPage(guard.ctx.workspace.id, guard.ctx.user.id, page)
  const res = NextResponse.json({ ok: true })
  res.cookies.set(SOCIAL_COOKIE, '', { path: SOCIAL_COOKIE_PATH, maxAge: 0 })
  return res
}
