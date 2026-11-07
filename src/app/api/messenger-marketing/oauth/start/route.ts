import crypto from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { getMetaConfig, metaAppReady } from '@/lib/platform/meta'
import { sign } from '@/app/api/channels/_lib/shared'
import { publicOrigin } from '@/lib/site-origin'

/**
 * GET /api/messenger-marketing/oauth/start — admin. Facebook Login for
 * Business with the Messenger marketing configuration (system user token,
 * page + ad account, ads_management / pages_messaging / paid_marketing_messages).
 */
export async function GET(request: NextRequest) {
  const back = (reason: string) => NextResponse.redirect(new URL(`/broadcasts?messenger=error&reason=${reason}`, publicOrigin(request)))
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return back('forbidden')
  const cfg = await getMetaConfig()
  if (!metaAppReady(cfg) || !cfg.marketingConfigId) return back('not_configured')
  const state = sign({ ws: guard.ctx.workspace.id, uid: guard.ctx.user.id, n: crypto.randomBytes(8).toString('hex'), t: Date.now() })
  const url = new URL(`https://www.facebook.com/${cfg.graphVersion}/dialog/oauth`)
  url.searchParams.set('client_id', cfg.appId!)
  url.searchParams.set('redirect_uri', `${publicOrigin(request)}/api/messenger-marketing/oauth/callback`)
  url.searchParams.set('state', state)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('config_id', cfg.marketingConfigId)
  return NextResponse.redirect(url)
}
