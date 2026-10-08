import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { listMemberships } from '@/lib/workspace/context'
import { hasRole } from '@/lib/workspace/constants'
import { getMlConfig } from '@/lib/real-estate/portals/mercadolibre/config'
import { MlApiError, exchangeCode, getMe } from '@/lib/real-estate/portals/mercadolibre/client'
import { saveMlConnection } from '@/lib/real-estate/portals/mercadolibre/connection'
import { appUrl } from '@/lib/real-estate/portals/mercadolibre/endpoints'
import { PKCE_COOKIE, portalStateSecret, verifyPortalState } from '@/lib/real-estate/portals/state'

const PAGE = '/real-estate/portals'

function back(result: string) {
  const res = NextResponse.redirect(new URL(`${PAGE}?ml=${encodeURIComponent(result)}`, appUrl()))
  res.cookies.set(PKCE_COOKIE, '', { path: '/api/real-estate/portals/mercadolibre', maxAge: 0 })
  return res
}

/**
 * GET /api/real-estate/portals/mercadolibre/callback?code&state — OAuth
 * redirect URI. Verifies the signed state, that the signed-in user is the
 * one who started the flow and is still an admin of that workspace, then
 * stores the (encrypted) tokens.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  if (params.get('error')) return back('denied')
  const check = verifyPortalState(params.get('state'), portalStateSecret())
  if (!check.ok) return back(`state_${check.reason}`)
  const { state } = check
  const code = params.get('code')
  if (!code || code.length > 500) return back('no_code')

  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  if (!user || user.id !== state.u) return back('session')
  const membership = (await listMemberships(user.id)).find((m) => m.workspace.id === state.w)
  if (!membership || !hasRole(membership.role, 'admin') || membership.workspace.industry !== 'real_estate') return back('forbidden')

  let verifier: string | null = null
  const cookie = request.cookies.get(PKCE_COOKIE)?.value
  if (cookie) {
    const [nonce, v] = cookie.split('.')
    if (nonce === state.n && v) verifier = v
  }

  try {
    const cfg = await getMlConfig()
    if (cfg.pkce && !verifier) return back('pkce')
    const tokens = await exchangeCode(cfg, code, verifier)
    const me = await getMe(cfg, tokens.access_token).catch(() => null)
    if (me && String(me.id) !== String(tokens.user_id)) return back('mismatch')
    await saveMlConnection(state.w, tokens, { nickname: me?.nickname ?? null, site_id: me?.site_id ?? null }, user.id)
    return back('connected')
  } catch (e) {
    console.error('[portals] mercadolibre callback', e instanceof MlApiError ? `${e.status} ${e.code}` : e)
    return back('exchange_failed')
  }
}
