import crypto from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { publicOrigin } from '@/lib/site-origin'
import { tiktokAppConfig, tiktokSandbox } from '@/lib/tiktok/config'
import { authorizeUrl } from '@/lib/tiktok/model'
import { sign } from '../../../_lib/shared'

/**
 * GET /api/channels/tiktok/oauth/start — admin. Sends the browser to TikTok
 * so the business authorizes Whasalia on its TikTok account. `state` is
 * HMAC-signed and carries the workspace + user (checked in the callback).
 * With TIKTOK_SANDBOX (local only) it shows a stand-in authorization page with a sample account.
 */
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request)
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return NextResponse.redirect(new URL('/channels?connect=tiktok&error=forbidden', origin))

  const state = sign({ ws: guard.ctx.workspace.id, uid: guard.ctx.user.id, n: crypto.randomBytes(8).toString('hex'), t: Date.now() })

  const cfg = tiktokAppConfig()
  if (!cfg) {
    if (!tiktokSandbox()) return NextResponse.redirect(new URL('/channels?connect=tiktok&error=not_configured', origin))
    // Local demo: our stand-in for TikTok's authorization screen.
    return NextResponse.redirect(new URL(`/tiktok-sandbox?${new URLSearchParams({ state })}`, origin))
  }
  return NextResponse.redirect(authorizeUrl(cfg.authUrl, state))
}
