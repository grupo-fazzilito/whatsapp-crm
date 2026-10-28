import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { getMetaConfig, metaAppReady } from '@/lib/platform/meta'
import {
  META_COOKIE_PATH,
  candidateCookieNames,
  candidateCookies,
  metaRedirectUri,
  verifySigned,
  type MetaCandidatePage,
} from '../../../_lib/shared'
import { publicOrigin } from '@/lib/site-origin'

/**
 * GET /api/channels/meta/oauth/callback — Facebook redirects here.
 * code → short-lived user token → long-lived user token → the user's pages
 * (page tokens derived from a long-lived user token don't expire). The
 * candidate pages + tokens are kept for 15 minutes in an encrypted httpOnly
 * cookie (never in the browser's JS, never in the DB), then the UI calls
 * POST /api/channels/meta/connect with the ones to connect.
 */

const STATE_TTL_MS = 15 * 60 * 1000

interface State {
  ws: string
  uid: string
  t: number
}

interface AccountsResponse {
  data?: {
    id: string
    name: string
    access_token?: string
    instagram_business_account?: { id: string; username?: string }
  }[]
  paging?: { next?: string }
  error?: { message?: string }
}

function back(request: NextRequest, params: Record<string, string>) {
  const url = new URL('/channels', publicOrigin(request))
  url.searchParams.set('connect', 'meta')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return NextResponse.redirect(url)
}

async function graphJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Meta API error: ${res.status}`)
  return data as T
}

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  if (q.get('error')) {
    // User cancelled or denied permissions.
    return back(request, { error: 'denied' })
  }

  const guard = await requireWorkspace('admin')
  if (!guard.ok) return back(request, { error: 'forbidden' })
  const cfg = await getMetaConfig()
  if (!metaAppReady(cfg)) return back(request, { error: 'not_configured' })
  const GRAPH = cfg.graphBase

  const state = verifySigned<State>(q.get('state'))
  if (
    !state ||
    Date.now() - state.t > STATE_TTL_MS ||
    state.ws !== guard.ctx.workspace.id ||
    state.uid !== guard.ctx.user.id
  ) {
    return back(request, { error: 'state' })
  }

  const code = q.get('code')
  if (!code) return back(request, { error: 'denied' })

  const appId = cfg.appId!
  const secret = cfg.appSecret!
  let pages: MetaCandidatePage[]
  try {
    const short = await graphJson<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          client_id: appId,
          client_secret: secret,
          redirect_uri: metaRedirectUri(request),
          code,
        }),
    )
    const long = await graphJson<{ access_token: string }>(
      `${GRAPH}/oauth/access_token?` +
        new URLSearchParams({
          grant_type: 'fb_exchange_token',
          client_id: appId,
          client_secret: secret,
          fb_exchange_token: short.access_token,
        }),
    )

    pages = []
    let next: string | undefined =
      `${GRAPH}/me/accounts?` +
      new URLSearchParams({
        fields: 'id,name,access_token,instagram_business_account{id,username}',
        limit: '100',
        access_token: long.access_token,
      })
    for (let i = 0; next && i < 5; i++) {
      const res: AccountsResponse = await graphJson<AccountsResponse>(next)
      for (const p of res.data ?? []) {
        if (!p.access_token) continue
        pages.push({
          id: p.id,
          name: p.name,
          token: p.access_token,
          ig: p.instagram_business_account
            ? { id: p.instagram_business_account.id, username: p.instagram_business_account.username ?? null }
            : null,
        })
      }
      next = res.paging?.next
    }
  } catch (err) {
    console.error('[meta-oauth] callback failed:', err instanceof Error ? err.message : err)
    return back(request, { error: 'exchange' })
  }

  if (pages.length === 0) return back(request, { error: 'no_pages' })

  let cookies: { name: string; value: string }[]
  try {
    cookies = candidateCookies({
      ws: guard.ctx.workspace.id,
      uid: guard.ctx.user.id,
      exp: Date.now() + STATE_TTL_MS,
      pages,
    })
  } catch {
    return back(request, { error: 'too_many' })
  }

  const response = back(request, {})
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: META_COOKIE_PATH,
    maxAge: STATE_TTL_MS / 1000,
  }
  // Clear leftovers from a previous attempt first.
  for (const name of candidateCookieNames()) response.cookies.set(name, '', { ...opts, maxAge: 0 })
  for (const c of cookies) response.cookies.set(c.name, c.value, opts)
  return response
}
