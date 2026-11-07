import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { getPublishingConfig, publishingReady } from '@/lib/social/config'
import { pagesFromCode } from '@/lib/social/graph'
import { connectPage } from '@/lib/social/server'
import { seal, verifySigned } from '@/app/api/channels/_lib/shared'
import { publicOrigin } from '@/lib/site-origin'
import { SOCIAL_COOKIE, SOCIAL_COOKIE_PATH, SOCIAL_TTL_MS, type SocialCandidates } from '../candidates/shared'

/**
 * GET /api/social/oauth/callback — Facebook redirects here. One page: it is
 * connected right away (with its Instagram account). Several: they're kept
 * 15 minutes in an encrypted httpOnly cookie and the business picks one.
 */
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request)
  const back = (params: string) => NextResponse.redirect(new URL(`/posts?${params}`, origin))
  const q = request.nextUrl.searchParams
  if (q.get('error')) return back('connect=error&reason=denied')
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return back('connect=error&reason=forbidden')
  const cfg = await getPublishingConfig()
  if (!publishingReady(cfg)) return back('connect=error&reason=not_configured')
  const state = verifySigned<{ ws: string; uid: string; t: number }>(q.get('state'))
  if (!state || Date.now() - state.t > SOCIAL_TTL_MS || state.ws !== guard.ctx.workspace.id || state.uid !== guard.ctx.user.id) {
    return back('connect=error&reason=state')
  }
  const code = q.get('code')
  if (!code) return back('connect=error&reason=denied')

  let pages
  try {
    pages = await pagesFromCode(code, `${origin}/api/social/oauth/callback`)
  } catch (err) {
    console.error('[social-oauth] callback failed:', err instanceof Error ? err.message : err)
    return back('connect=error&reason=exchange')
  }
  if (!pages.length) return back('connect=error&reason=no_pages')
  if (pages.length === 1) {
    await connectPage(guard.ctx.workspace.id, guard.ctx.user.id, pages[0])
    return back('connect=ok')
  }
  // One cookie (~4 KB): as many pages as fit, those with Instagram first.
  const ordered = [...pages].sort((a, b) => Number(!!b.ig) - Number(!!a.ig))
  const data: SocialCandidates = { ws: guard.ctx.workspace.id, uid: guard.ctx.user.id, exp: Date.now() + SOCIAL_TTL_MS, pages: ordered.slice(0, 20) }
  let sealed = seal(data)
  while (sealed.length > 3800 && data.pages.length > 1) {
    data.pages = data.pages.slice(0, -1)
    sealed = seal(data)
  }
  const res = back('connect=pick')
  res.cookies.set(SOCIAL_COOKIE, sealed, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: SOCIAL_COOKIE_PATH, maxAge: SOCIAL_TTL_MS / 1000 })
  return res
}
