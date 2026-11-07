import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { getMetaConfig, metaAppReady } from '@/lib/platform/meta'
import { assetsFromCode } from '@/lib/messenger-marketing/graph'
import { saveConnection } from '@/lib/messenger-marketing/server'
import { seal, verifySigned } from '@/app/api/channels/_lib/shared'
import { publicOrigin } from '@/lib/site-origin'
import { MM_COOKIE, MM_COOKIE_PATH, MM_TTL_MS, type MarketingCandidates } from '../../shared'

/**
 * GET /api/messenger-marketing/oauth/callback — the page must be a
 * Messenger channel already connected in Canales. One page + one ad account:
 * connected right away; several: the business picks (encrypted cookie).
 */
export async function GET(request: NextRequest) {
  const back = (params: string) => NextResponse.redirect(new URL(`/broadcasts?${params}`, publicOrigin(request)))
  const q = request.nextUrl.searchParams
  if (q.get('error')) return back('messenger=error&reason=denied')
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return back('messenger=error&reason=forbidden')
  const cfg = await getMetaConfig()
  if (!metaAppReady(cfg)) return back('messenger=error&reason=not_configured')
  const state = verifySigned<{ ws: string; uid: string; t: number }>(q.get('state'))
  const { workspace, user, db } = guard.ctx
  if (!state || Date.now() - state.t > MM_TTL_MS || state.ws !== workspace.id || state.uid !== user.id) return back('messenger=error&reason=state')
  const code = q.get('code')
  if (!code) return back('messenger=error&reason=denied')

  let assets
  try {
    assets = await assetsFromCode(code, `${publicOrigin(request)}/api/messenger-marketing/oauth/callback`)
  } catch (err) {
    console.error('[messenger-marketing] callback failed:', err instanceof Error ? err.message : err)
    return back('messenger=error&reason=exchange')
  }
  const channels = await db.channels.findMany({ where: { type: 'messenger', status: 'connected' }, select: { id: true, external_id: true } })
  const pages = assets.pages.filter((p) => channels.some((c) => c.external_id === p.id))
  if (!pages.length) return back('messenger=error&reason=no_page')
  if (!assets.adAccounts.length) return back('messenger=error&reason=no_ad_account')
  if (pages.length === 1 && assets.adAccounts.length === 1) {
    const channel = channels.find((c) => c.external_id === pages[0].id)!
    await saveConnection(workspace.id, user.id, { channelId: channel.id, pageId: pages[0].id, adAccount: assets.adAccounts[0], token: assets.token })
    return back('messenger=connected')
  }
  const data: MarketingCandidates = { ws: workspace.id, uid: user.id, exp: Date.now() + MM_TTL_MS, token: assets.token, pages: pages.slice(0, 10), adAccounts: assets.adAccounts.slice(0, 15) }
  const res = back('messenger=pick')
  res.cookies.set(MM_COOKIE, seal(data), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: MM_COOKIE_PATH, maxAge: MM_TTL_MS / 1000 })
  return res
}
