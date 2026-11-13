import { NextResponse, after, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { publicOrigin } from '@/lib/site-origin'
import { tenantDb } from '@/lib/db/tenant'
import { prisma } from '@/lib/db/prisma'
import { saveChannelSecrets } from '@/lib/channels/store'
import { tiktokConnectReady } from '@/lib/tiktok/config'
import { tiktokRedirectUri } from '@/lib/tiktok/model'
import { exchangeCode, getProfile, subscribeCommentWebhook } from '@/lib/tiktok/api'
import { insertChannel } from '../../../_lib/create'
import { verifySigned } from '../../../_lib/shared'

/**
 * GET /api/channels/tiktok/oauth/callback — TikTok sends the business back
 * here with `auth_code` + our `state`. auth_code → tokens + open_id →
 * profile → the TikTok channel (tokens encrypted in channel_secrets).
 * Connecting the same account again only refreshes its tokens.
 */

const STATE_TTL_MS = 15 * 60 * 1000

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/channels', publicOrigin(request))
  url.searchParams.set('connect', 'tiktok')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const code = q.get('auth_code') ?? q.get('code')
  if (q.get('error') || !code) return back(request, { error: 'denied' })

  const guard = await requireWorkspace('admin')
  if (!guard.ok) return back(request, { error: 'forbidden' })
  if (!tiktokConnectReady()) return back(request, { error: 'not_configured' })
  const { workspace, user } = guard.ctx

  const state = verifySigned<{ ws: string; uid: string; t: number }>(q.get('state'))
  if (!state || Date.now() - state.t > STATE_TTL_MS || state.ws !== workspace.id || state.uid !== user.id) {
    return back(request, { error: 'state' })
  }

  const origin = publicOrigin(request)
  let tokens: Awaited<ReturnType<typeof exchangeCode>>
  let profile: Awaited<ReturnType<typeof getProfile>>
  try {
    tokens = await exchangeCode(code, tiktokRedirectUri(origin))
    profile = await getProfile(tokens.accessToken, tokens.openId)
  } catch (err) {
    console.error('[tiktok-oauth] callback failed:', err instanceof Error ? err.message : err)
    return back(request, { error: 'exchange' })
  }

  const secrets = {
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken || null,
    token_expires_at: String(tokens.expiresAt),
  }
  const settings = { avatar_url: profile.avatar, scopes: tokens.scope.split(',').filter(Boolean) }
  const name = profile.displayName || (profile.username ? `@${profile.username}` : 'TikTok')

  // Platform lookup: the account may already be connected (here or in another business).
  const existing = await prisma.channels.findFirst({ where: { type: 'tiktok', external_id: tokens.openId }, select: { id: true, workspace_id: true } })
  if (existing && existing.workspace_id !== workspace.id) return back(request, { error: 'conflict' })

  if (existing) {
    await tenantDb(workspace.id).channels.updateMany({
      where: { id: existing.id },
      data: { status: 'connected', status_detail: null, display_handle: profile.username, settings, updated_at: new Date() },
    })
    await saveChannelSecrets(existing.id, secrets)
  } else {
    const created = await insertChannel({
      workspaceId: workspace.id,
      userId: user.id,
      type: 'tiktok',
      name,
      externalId: tokens.openId,
      displayHandle: profile.username,
      settings,
      secrets,
    })
    if (!created.ok) return back(request, { error: created.conflict ? 'conflict' : 'exchange' })
  }

  // New comments reach /api/webhooks/tiktok (one subscription for the whole app).
  after(() =>
    subscribeCommentWebhook(`${origin}/api/webhooks/tiktok`).catch((err) =>
      console.error('[tiktok-oauth] webhook subscription failed:', err instanceof Error ? err.message : err),
    ),
  )
  return back(request, { ok: '1' })
}
