import 'server-only'
import { getPublishingConfig } from './config'
import type { PostFormat, PostMedia } from './model'

// Meta Graph calls of Publicaciones, with the page token of the second Meta
// app (pages_manage_posts, instagram_content_publish).
// Facebook page:
//   photo          POST /{page}/photos { url, message }
//   several photos POST /{page}/photos { url, published:false } each, then /{page}/feed { attached_media }
//   video          POST /{page}/videos { file_url, description }
//   reel           /{page}/video_reels start → rupload (file_url) → finish (PUBLISHED)
//   story          photo: /{page}/photo_stories { photo_id }; video: /{page}/video_stories start → rupload → finish
// Instagram (professional account linked to the page):
//   POST /{ig}/media (container) → wait for status FINISHED (videos) → POST /{ig}/media_publish
//   carousel: one container per item (is_carousel_item) + a CAROUSEL container with the children

export class SocialGraphError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
  ) {
    super(message)
  }
  /** The token lost access (password change, permission removed…): the business must reconnect. */
  get auth() {
    return this.code === 190 || this.code === 10 || (this.code !== null && this.code >= 200 && this.code < 300)
  }
}

async function call<T = Record<string, unknown>>(path: string, token: string, params: Record<string, unknown> = {}, method: 'GET' | 'POST' = 'POST'): Promise<T> {
  const { graphBase } = await getPublishingConfig()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) qs.set(k, typeof v === 'string' ? v : JSON.stringify(v))
  const url = `${graphBase}${path}`
  const res = await fetch(method === 'GET' ? `${url}?${qs}` : url, {
    method,
    cache: 'no-store',
    headers: { Authorization: `Bearer ${token}`, ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: method === 'POST' ? qs : undefined,
    signal: AbortSignal.timeout(90_000),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; error_user_msg?: string; code?: number } }
  if (!res.ok || body.error) {
    const e = body.error
    throw new SocialGraphError((e?.error_user_msg || e?.message || `Meta API error ${res.status}`).slice(0, 400), e?.code ?? null)
  }
  return body as T
}

/** Hosted upload of a video by URL (Facebook reels and video stories). */
async function ruploadFromUrl(videoId: string, token: string, fileUrl: string, uploadUrl?: string): Promise<void> {
  const { graphBase, graphVersion } = await getPublishingConfig()
  const target = uploadUrl || (graphBase.startsWith('https://graph.facebook.com') ? `https://rupload.facebook.com/video-upload/${graphVersion}/${videoId}` : `${graphBase}/rupload/${videoId}`)
  const res = await fetch(target, { method: 'POST', headers: { Authorization: `OAuth ${token}`, file_url: fileUrl }, signal: AbortSignal.timeout(120_000) })
  const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: { message?: string; code?: number } }
  if (!res.ok || body.error || body.success === false) throw new SocialGraphError(body.error?.message ?? `Video upload failed (${res.status})`, body.error?.code ?? null)
}

export interface Published {
  id: string
  url: string | null
}

// ------------------------------------------------------------------
// Facebook page
// ------------------------------------------------------------------
export async function publishFacebook(page: { id: string; token: string }, format: PostFormat, media: PostMedia[], caption: string): Promise<Published> {
  const p = encodeURIComponent(page.id)
  const images = media.filter((m) => m.type === 'image')
  const video = media.find((m) => m.type === 'video')

  if (format === 'story') {
    const item = media[0]
    if (item.type === 'image') {
      const photo = await call<{ id: string }>(`/${p}/photos`, page.token, { url: item.url, published: 'false' })
      const r = await call<{ post_id?: string }>(`/${p}/photo_stories`, page.token, { photo_id: photo.id })
      return { id: r.post_id ?? photo.id, url: null }
    }
    const start = await call<{ video_id: string; upload_url?: string }>(`/${p}/video_stories`, page.token, { upload_phase: 'start' })
    await ruploadFromUrl(start.video_id, page.token, item.url, start.upload_url)
    const r = await call<{ post_id?: string }>(`/${p}/video_stories`, page.token, { upload_phase: 'finish', video_id: start.video_id })
    return { id: r.post_id ?? start.video_id, url: null }
  }

  if (format === 'reel' && video) {
    const start = await call<{ video_id: string; upload_url?: string }>(`/${p}/video_reels`, page.token, { upload_phase: 'start' })
    await ruploadFromUrl(start.video_id, page.token, video.url, start.upload_url)
    await call(`/${p}/video_reels`, page.token, { upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: caption })
    return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` }
  }

  // Feed post: photos (a video can't share a post with photos on Facebook).
  if (images.length === 1) {
    const r = await call<{ id: string; post_id?: string }>(`/${p}/photos`, page.token, { url: images[0].url, message: caption })
    return { id: r.post_id ?? r.id, url: `https://www.facebook.com/${r.post_id ?? r.id}` }
  }
  if (images.length > 1) {
    const ids: string[] = []
    for (const img of images) ids.push((await call<{ id: string }>(`/${p}/photos`, page.token, { url: img.url, published: 'false' })).id)
    const r = await call<{ id: string }>(`/${p}/feed`, page.token, { message: caption, attached_media: ids.map((media_fbid) => ({ media_fbid })) })
    return { id: r.id, url: `https://www.facebook.com/${r.id}` }
  }
  if (video) {
    const r = await call<{ id: string }>(`/${p}/videos`, page.token, { file_url: video.url, description: caption })
    return { id: r.id, url: `https://www.facebook.com/${encodeURIComponent(page.id)}/videos/${r.id}` }
  }
  throw new SocialGraphError('media_required')
}

// ------------------------------------------------------------------
// Instagram
// ------------------------------------------------------------------
type ContainerStatus = 'FINISHED' | 'IN_PROGRESS' | 'ERROR' | 'EXPIRED' | 'PUBLISHED'

export async function containerStatus(containerId: string, token: string): Promise<ContainerStatus> {
  const r = await call<{ status_code?: ContainerStatus }>(`/${encodeURIComponent(containerId)}`, token, { fields: 'status_code' }, 'GET')
  return r.status_code ?? 'IN_PROGRESS'
}

/** Waits up to `maxMs` for a container; true = ready to publish. */
async function waitReady(containerId: string, token: string, maxMs: number): Promise<boolean> {
  const until = Date.now() + maxMs
  for (;;) {
    const s = await containerStatus(containerId, token)
    if (s === 'FINISHED' || s === 'PUBLISHED') return true
    if (s === 'ERROR' || s === 'EXPIRED') throw new SocialGraphError(s === 'ERROR' ? 'instagram_media_error' : 'instagram_media_expired')
    if (Date.now() + 4000 > until) return false
    await new Promise((r) => setTimeout(r, 4000))
  }
}

/**
 * Creates the container(s). Videos take a while: returns the container to
 * publish later when it isn't ready within `waitMs`.
 */
export async function prepareInstagram(
  ig: { id: string; token: string },
  format: PostFormat,
  media: PostMedia[],
  caption: string,
  waitMs = 60_000,
): Promise<{ container: string; ready: boolean }> {
  const u = encodeURIComponent(ig.id)
  const item = (m: PostMedia, extra: Record<string, unknown> = {}) =>
    m.type === 'image' ? { image_url: m.url, ...extra } : { video_url: m.url, media_type: extra.is_carousel_item ? 'VIDEO' : 'REELS', ...extra }

  let container: string
  if (format === 'story') {
    container = (await call<{ id: string }>(`/${u}/media`, ig.token, { ...item(media[0]), media_type: 'STORIES' })).id
  } else if (format === 'reel') {
    container = (await call<{ id: string }>(`/${u}/media`, ig.token, { video_url: media[0].url, media_type: 'REELS', caption })).id
  } else if (media.length === 1) {
    container = (await call<{ id: string }>(`/${u}/media`, ig.token, { ...item(media[0]), caption })).id
  } else {
    const children: string[] = []
    for (const m of media.slice(0, 10)) children.push((await call<{ id: string }>(`/${u}/media`, ig.token, item(m, { is_carousel_item: 'true' }))).id)
    for (const c of children) if (!(await waitReady(c, ig.token, waitMs))) throw new SocialGraphError('instagram_video_slow')
    container = (await call<{ id: string }>(`/${u}/media`, ig.token, { media_type: 'CAROUSEL', children: children.join(','), caption })).id
  }
  const hasVideo = media.some((m) => m.type === 'video')
  return { container, ready: hasVideo ? await waitReady(container, ig.token, waitMs) : true }
}

export async function publishInstagramContainer(ig: { id: string; token: string }, container: string): Promise<Published> {
  const r = await call<{ id: string }>(`/${encodeURIComponent(ig.id)}/media_publish`, ig.token, { creation_id: container })
  const link = await call<{ permalink?: string }>(`/${encodeURIComponent(r.id)}`, ig.token, { fields: 'permalink' }, 'GET').catch(() => ({}) as { permalink?: string })
  return { id: r.id, url: link.permalink ?? null }
}

// ------------------------------------------------------------------
// Connection
// ------------------------------------------------------------------
export interface PageCandidate {
  id: string
  name: string
  token: string
  picture: string | null
  ig: { id: string; username: string | null; picture: string | null } | null
}

/** OAuth code → long-lived user token → the pages (with their Instagram account) the business granted. */
export async function pagesFromCode(code: string, redirectUri: string): Promise<PageCandidate[]> {
  const cfg = await getPublishingConfig()
  const get = async <T>(path: string, params: Record<string, string>): Promise<T> => {
    const res = await fetch(`${cfg.graphBase}${path}?${new URLSearchParams(params)}`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
    const data = (await res.json().catch(() => ({}))) as T & { error?: { message?: string; code?: number } }
    if (!res.ok || data.error) throw new SocialGraphError(data.error?.message ?? `Meta API error ${res.status}`, data.error?.code ?? null)
    return data
  }
  const short = await get<{ access_token: string }>('/oauth/access_token', { client_id: cfg.appId!, client_secret: cfg.appSecret!, redirect_uri: redirectUri, code })
  const long = await get<{ access_token: string }>('/oauth/access_token', {
    grant_type: 'fb_exchange_token',
    client_id: cfg.appId!,
    client_secret: cfg.appSecret!,
    fb_exchange_token: short.access_token,
  })
  type Accounts = {
    data?: { id: string; name: string; access_token?: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string; profile_picture_url?: string } }[]
    paging?: { next?: string }
  }
  const pages: PageCandidate[] = []
  let res = await get<Accounts>('/me/accounts', {
    fields: 'id,name,access_token,picture{url},instagram_business_account{id,username,profile_picture_url}',
    limit: '100',
    access_token: long.access_token,
  })
  for (let i = 0; i < 5; i++) {
    for (const p of res.data ?? []) {
      if (!p.access_token) continue
      const ig = p.instagram_business_account
      pages.push({
        id: p.id,
        name: p.name,
        token: p.access_token,
        picture: p.picture?.data?.url ?? null,
        ig: ig ? { id: ig.id, username: ig.username ?? null, picture: ig.profile_picture_url ?? null } : null,
      })
    }
    const next = res.paging?.next
    if (!next) break
    const r = await fetch(next, { cache: 'no-store' })
    res = (await r.json().catch(() => ({}))) as Accounts
  }
  return pages
}
