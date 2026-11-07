import crypto from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { getPublishingConfig, publishingReady, PUBLISH_SCOPES } from '@/lib/social/config'
import { sign } from '@/app/api/channels/_lib/shared'
import { publicOrigin } from '@/lib/site-origin'

/**
 * GET /api/social/oauth/start — admin. Facebook Login (the publishing Meta
 * app) to pick the page and Instagram account to publish to. `state` is
 * HMAC-signed and carries the workspace + user.
 */
export async function GET(request: NextRequest) {
  const back = (error: string) => NextResponse.redirect(new URL(`/posts?connect=error&reason=${error}`, publicOrigin(request)))
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return back('forbidden')
  const cfg = await getPublishingConfig()
  if (!publishingReady(cfg)) return back('not_configured')
  const state = sign({ ws: guard.ctx.workspace.id, uid: guard.ctx.user.id, n: crypto.randomBytes(8).toString('hex'), t: Date.now() })
  const url = new URL(`https://www.facebook.com/${cfg.graphVersion}/dialog/oauth`)
  url.searchParams.set('client_id', cfg.appId!)
  url.searchParams.set('redirect_uri', `${publicOrigin(request)}/api/social/oauth/callback`)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  if (cfg.configId) url.searchParams.set('config_id', cfg.configId)
  else url.searchParams.set('scope', PUBLISH_SCOPES.join(','))
  return NextResponse.redirect(url)
}
