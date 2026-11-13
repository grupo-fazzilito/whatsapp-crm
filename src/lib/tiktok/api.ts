import 'server-only'
import type { LoadedChannel } from '@/lib/channels'
import { saveChannelSecrets } from '@/lib/channels/store'
import type { RecentPost } from '@/lib/comments/meta'
import { tiktokAppConfig, tiktokSandbox } from './config'
import { TIKTOK_API, TIKTOK_REPLY_MAX, quoteBigInts, tokenNeedsRefresh } from './model'
import { SANDBOX_ACCOUNT, SANDBOX_CODE, SANDBOX_VIDEOS } from './sandbox'

// Accounts API calls (TikTok API for Business v1.3). Every call answers
// { code, message, request_id, data }; code 0 is success.
//   POST /tt_user/oauth2/token/          auth_code → tokens + open_id
//   POST /tt_user/oauth2/refresh_token/  access token lasts 1 day, refresh token 1 year
//   GET  /business/get/                  profile         (user.info.basic)
//   GET  /business/video/list/           owned posts     (video.list)
//   GET  /business/comment/list/         comments        (comment.list)
//   POST /business/comment/reply/create/ public reply    (comment.list.manage)
//   POST /business/webhook/update/       app-level comment.update subscription

export class TiktokError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message)
    this.name = 'TiktokError'
  }
  /** Token expired/revoked or a scope is missing: the account has to be connected again. */
  get needsReconnect() {
    return /access[ _-]?token|refresh[ _-]?token|scope|permission|authori[sz]/i.test(this.message)
  }
}

interface Envelope<T> {
  code?: number
  message?: string
  request_id?: string
  data?: T
}

async function call<T>(path: string, init: { token?: string; query?: Record<string, string>; body?: Record<string, unknown> }): Promise<T> {
  const url = new URL(`${TIKTOK_API}${path}`)
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v)
  const res = await fetch(url, {
    method: init.body ? 'POST' : 'GET',
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.token ? { 'Access-Token': init.token } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  let data: Envelope<T> = {}
  try {
    data = JSON.parse(quoteBigInts(await res.text())) as Envelope<T>
  } catch {
    // Not JSON: reported below with the HTTP status.
  }
  if (!res.ok || data.code !== 0) {
    throw new TiktokError(`${data.message ?? `TikTok API error: ${res.status}`}${data.request_id ? ` (request ${data.request_id})` : ''}`, data.code ?? null)
  }
  return (data.data ?? {}) as T
}

function app() {
  const cfg = tiktokAppConfig()
  if (!cfg) throw new TiktokError('TikTok app is not configured', null)
  return cfg
}

export interface TiktokTokens {
  accessToken: string
  refreshToken: string
  /** ms epoch */
  expiresAt: number
  openId: string
  scope: string
}

interface TokenData {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  open_id?: string
  scope?: string
}

function tokens(d: TokenData): TiktokTokens {
  if (!d.access_token || !d.open_id) throw new TiktokError('TikTok did not return an access token', null)
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token ?? '',
    expiresAt: Date.now() + (d.expires_in ?? 86_400) * 1000,
    openId: d.open_id,
    scope: d.scope ?? '',
  }
}

export async function exchangeCode(code: string, redirectUri: string): Promise<TiktokTokens> {
  if (tiktokSandbox() && code === SANDBOX_CODE) {
    return { accessToken: 'sandbox-access', refreshToken: 'sandbox-refresh', expiresAt: Date.now() + 86_400_000, openId: SANDBOX_ACCOUNT.openId, scope: 'user.info.basic,video.list,comment.list,comment.list.manage' }
  }
  const cfg = app()
  return tokens(
    await call<TokenData>('/tt_user/oauth2/token/', {
      body: { client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'authorization_code', auth_code: code, redirect_uri: redirectUri },
    }),
  )
}

const isSandboxChannel = (channel: LoadedChannel) => tiktokSandbox() && channel.external_id === SANDBOX_ACCOUNT.openId

/** A valid access token for the channel, renewed (and saved) when it's about to expire. */
export async function accessToken(channel: LoadedChannel): Promise<string> {
  const s = channel.secrets
  if (!s.access_token) throw new TiktokError('TikTok access token missing', null)
  if (isSandboxChannel(channel) || !tokenNeedsRefresh(s.token_expires_at)) return s.access_token
  if (!s.refresh_token) throw new TiktokError('TikTok refresh token missing', null)
  const cfg = app()
  const fresh = tokens(
    await call<TokenData>('/tt_user/oauth2/refresh_token/', {
      body: { client_id: cfg.appId, client_secret: cfg.appSecret, grant_type: 'refresh_token', refresh_token: s.refresh_token },
    }),
  )
  await saveChannelSecrets(channel.id, {
    access_token: fresh.accessToken,
    refresh_token: fresh.refreshToken || s.refresh_token,
    token_expires_at: String(fresh.expiresAt),
  })
  channel.secrets = { ...s, access_token: fresh.accessToken, refresh_token: fresh.refreshToken || s.refresh_token, token_expires_at: String(fresh.expiresAt) }
  return fresh.accessToken
}

export interface TiktokProfile {
  username: string | null
  displayName: string | null
  avatar: string | null
}

export async function getProfile(token: string, openId: string): Promise<TiktokProfile> {
  if (tiktokSandbox() && openId === SANDBOX_ACCOUNT.openId) {
    return { username: SANDBOX_ACCOUNT.username, displayName: SANDBOX_ACCOUNT.displayName, avatar: null }
  }
  const d = await call<{ username?: string; display_name?: string; profile_image?: string }>('/business/get/', {
    token,
    query: { business_id: openId, fields: JSON.stringify(['username', 'display_name', 'profile_image']) },
  })
  return { username: d.username ?? null, displayName: d.display_name ?? null, avatar: d.profile_image ?? null }
}

/** Latest posts of the account, to aim a comment rule at one of them. */
export async function listVideos(channel: LoadedChannel, limit = 20): Promise<RecentPost[]> {
  if (isSandboxChannel(channel)) return SANDBOX_VIDEOS
  const d = await call<{ videos?: { item_id: string; caption?: string; thumbnail_url?: string; share_url?: string; create_time?: number }[] }>('/business/video/list/', {
    token: await accessToken(channel),
    query: {
      business_id: channel.external_id,
      fields: JSON.stringify(['item_id', 'caption', 'thumbnail_url', 'share_url', 'create_time']),
      max_count: String(Math.min(limit, 20)),
    },
  })
  return (d.videos ?? []).map((v) => ({
    id: String(v.item_id),
    text: v.caption ?? '',
    imageUrl: v.thumbnail_url ?? null,
    permalink: v.share_url ?? null,
    createdAt: v.create_time ? new Date(v.create_time * 1000).toISOString() : null,
  }))
}

export interface TiktokComment {
  username: string | null
  displayName: string | null
  /** Written by the account itself (our own replies included). */
  owner: boolean
  text: string | null
}

/** One comment by id: the webhook doesn't say who wrote it. */
export async function getComment(channel: LoadedChannel, videoId: string, commentId: string): Promise<TiktokComment | null> {
  const d = await call<{ comments?: { comment_id: string | number; username?: string; display_name?: string; owner?: boolean; text?: string }[] }>('/business/comment/list/', {
    token: await accessToken(channel),
    query: { business_id: channel.external_id, video_id: videoId, comment_ids: JSON.stringify([commentId]) },
  })
  const c = d.comments?.[0]
  if (!c) return null
  return { username: c.username ?? null, displayName: c.display_name ?? null, owner: !!c.owner, text: c.text ?? null }
}

/** Public reply under the comment; returns the new reply's id. */
export async function replyToTiktokComment(channel: LoadedChannel, videoId: string, commentId: string, text: string): Promise<string | null> {
  if (isSandboxChannel(channel)) return `sandbox-reply-${Date.now()}`
  const res = await call<{ comment_id?: string | number }>('/business/comment/reply/create/', {
    token: await accessToken(channel),
    body: { business_id: channel.external_id, video_id: videoId, comment_id: commentId, text: text.slice(0, TIKTOK_REPLY_MAX) },
  })
  return res.comment_id != null ? String(res.comment_id) : null
}

/** App-level: send comment.update events for every authorized account to our webhook. Idempotent. */
export async function subscribeCommentWebhook(callbackUrl: string): Promise<void> {
  if (tiktokSandbox() && !tiktokAppConfig()) return
  const cfg = app()
  await call('/business/webhook/update/', { body: { app_id: cfg.appId, secret: cfg.appSecret, event_type: 'COMMENT', callback_url: callbackUrl } })
}
