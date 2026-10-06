import crypto from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { META_SCOPES, metaOAuthAvailable, metaRedirectUri, sign } from '../../../_lib/shared'

/**
 * GET /api/channels/meta/oauth/start — admin. Sends the browser to
 * Facebook Login for Business to pick the pages / Instagram accounts to
 * connect. `state` is HMAC-signed (ENCRYPTION_KEY) and carries the
 * workspace + user, so the callback can't be replayed into another account.
 */

export async function GET(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) {
    return NextResponse.redirect(new URL('/channels?connect=meta&error=forbidden', request.url))
  }
  if (!metaOAuthAvailable()) {
    return NextResponse.redirect(new URL('/channels?connect=meta&error=not_configured', request.url))
  }

  const state = sign({
    ws: guard.ctx.workspace.id,
    uid: guard.ctx.user.id,
    n: crypto.randomBytes(8).toString('hex'),
    t: Date.now(),
  })

  const url = new URL('https://www.facebook.com/v21.0/dialog/oauth')
  url.searchParams.set('client_id', process.env.META_APP_ID!)
  url.searchParams.set('redirect_uri', metaRedirectUri(request))
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  // Facebook Login for Business can use a saved configuration instead of
  // a raw scope list (Meta app → Facebook Login for Business → Configurations).
  if (process.env.META_LOGIN_CONFIG_ID) url.searchParams.set('config_id', process.env.META_LOGIN_CONFIG_ID)
  else url.searchParams.set('scope', META_SCOPES.join(','))
  return NextResponse.redirect(url)
}
