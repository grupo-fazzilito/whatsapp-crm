import { NextResponse } from 'next/server'
import { getMlConfig } from '@/lib/real-estate/portals/mercadolibre/config'
import { authorizeUrl } from '@/lib/real-estate/portals/mercadolibre/client'
import { appUrl } from '@/lib/real-estate/portals/mercadolibre/endpoints'
import { PKCE_COOKIE, pkcePair, portalStateSecret, signPortalState } from '@/lib/real-estate/portals/state'
import { requirePortalsAdmin } from '../../_lib/guard'

const PAGE = '/real-estate/portals'

/**
 * GET /api/real-estate/portals/mercadolibre/connect → 302 to Mercado Libre's
 * authorization page (signed state; PKCE when the app has it enabled).
 */
export async function GET() {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const cfg = await getMlConfig()
  if (!cfg.clientId || !cfg.clientSecret) return NextResponse.redirect(new URL(`${PAGE}?ml=not_configured`, appUrl()))

  const nonce = crypto.randomUUID()
  const state = signPortalState({ w: guard.ctx.workspace.id, u: guard.ctx.user.id, p: 'mercadolibre', n: nonce }, portalStateSecret())
  const pkce = cfg.pkce ? pkcePair() : null
  const res = NextResponse.redirect(authorizeUrl(cfg, state, pkce?.challenge))
  if (pkce) {
    res.cookies.set(PKCE_COOKIE, `${nonce}.${pkce.verifier}`, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/real-estate/portals/mercadolibre',
      maxAge: 600,
    })
  }
  return res
}
