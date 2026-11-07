import 'server-only'
import crypto from 'node:crypto'
import { after } from 'next/server'
import sharp from 'sharp'
import type { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { downloadObject, publicUrl, uploadObject } from '@/lib/storage'
import { storagePathFromUrl } from '@/lib/storage/paths'
import { siteUrl } from '@/lib/real-estate/listing/url'
import { storePath, storeSettings } from '@/lib/store/settings'
import { fallbackCaption, writeCaption, type CaptionInput } from './ai'
import { containerStatus, prepareInstagram, publishFacebook, publishInstagramContainer, SocialGraphError, type PageCandidate } from './graph'
import {
  AUTO_DELAY_MINUTES,
  captionFor,
  normalizeSocial,
  overallStatus,
  upcomingSlots,
  type PostFormat,
  type PostInput,
  type PostMedia,
  type PostOrigin,
  type PostStatus,
  type SocialSettings,
  type Target,
  type TargetResult,
} from './model'
import { ensureStatusTemplate, sendStatusPost } from './whatsapp-status'

// Publicaciones: connected accounts, posts, publishing (now or by the cron),
// automatic posts (new product, restock, weekly calendar).

// ------------------------------------------------------------------
// Workspace + settings
// ------------------------------------------------------------------
export interface SocialWorkspace {
  id: string
  name: string
  slug: string
  locale: string
  currency: string
  country: string | null
  timezone: string
  description: string | null
  settings: Record<string, unknown>
}

const WS_SELECT = { id: true, name: true, slug: true, locale: true, currency: true, country: true, timezone: true, description: true, settings: true } as const

export async function loadSocialWorkspace(id: string): Promise<SocialWorkspace | null> {
  const ws = await prisma.workspaces.findUnique({ where: { id }, select: WS_SELECT })
  return ws ? { ...ws, settings: (ws.settings ?? {}) as Record<string, unknown> } : null
}

export const socialSettingsOf = (ws: { settings: Record<string, unknown> | null }) => normalizeSocial(ws.settings?.social)

export async function saveSocialSettings(ws: SocialWorkspace, raw: unknown, userId: string): Promise<SocialSettings> {
  const next = normalizeSocial(raw)
  const fresh = await prisma.workspaces.findUnique({ where: { id: ws.id }, select: { settings: true } })
  const settings = { ...((fresh?.settings ?? {}) as Record<string, unknown>), social: next }
  await prisma.workspaces.update({ where: { id: ws.id }, data: { settings: settings as unknown as Prisma.InputJsonValue } })
  if (next.status_phones.length) await ensureStatusTemplate(ws.id, userId)
  return next
}

const absolute = (u: string) => (/^https?:\/\//.test(u) ? u : `${siteUrl()}${u.startsWith('/') ? '' : '/'}${u}`)

/** Public link of a product in the store, when the store is published. */
function productLink(ws: SocialWorkspace, productId: string | null): string | null {
  if (!productId || !storeSettings(ws.settings?.store).enabled) return null
  return `${siteUrl()}${storePath(ws.slug)}/producto/${productId}`
}

// ------------------------------------------------------------------
// Connected accounts
// ------------------------------------------------------------------
export interface SocialAccountView {
  id: string
  network: 'facebook' | 'instagram'
  external_id: string
  name: string
  username: string | null
  picture_url: string | null
  status: string
  last_error: string | null
  created_at: string
}

export async function listAccounts(workspaceId: string): Promise<SocialAccountView[]> {
  const rows = await tenantDb(workspaceId).social_accounts.findMany({
    select: { id: true, network: true, external_id: true, name: true, username: true, picture_url: true, status: true, last_error: true, created_at: true },
    orderBy: { network: 'asc' },
  })
  return rows.map((r) => ({ ...r, network: r.network as SocialAccountView['network'], created_at: String(r.created_at) }))
}

/** Connects one Facebook page (and its Instagram account). Replaces the previous one: one page per business. */
export async function connectPage(workspaceId: string, userId: string, page: PageCandidate): Promise<void> {
  const db = tenantDb(workspaceId)
  const token = encrypt(page.token)
  const rows = [
    { network: 'facebook', external_id: page.id, name: page.name, username: null, picture_url: page.picture },
    ...(page.ig ? [{ network: 'instagram', external_id: page.ig.id, name: page.ig.username ? `@${page.ig.username}` : page.name, username: page.ig.username, picture_url: page.ig.picture }] : []),
  ]
  await db.social_accounts.deleteMany({ where: { NOT: { OR: rows.map((r) => ({ network: r.network, external_id: r.external_id })) } } })
  for (const r of rows) {
    const data = { ...r, page_id: page.id, access_token: token, status: 'active', last_error: null, connected_by: userId, updated_at: new Date() }
    const existing = await db.social_accounts.findFirst({ where: { network: r.network, external_id: r.external_id }, select: { id: true } })
    if (existing) await db.social_accounts.update({ where: { id: existing.id }, data })
    else await db.social_accounts.create({ data: { ...data, workspace_id: workspaceId } })
  }
}

export async function disconnectAll(workspaceId: string): Promise<void> {
  await tenantDb(workspaceId).social_accounts.deleteMany({})
}

async function accountFor(workspaceId: string, network: 'facebook' | 'instagram'): Promise<{ id: string; external_id: string; token: string } | null> {
  const row = await tenantDb(workspaceId).social_accounts.findFirst({ where: { network }, select: { id: true, external_id: true, access_token: true } })
  if (!row) return null
  try {
    return { id: row.id, external_id: row.external_id, token: decrypt(row.access_token) }
  } catch {
    return null
  }
}

// ------------------------------------------------------------------
// Posts
// ------------------------------------------------------------------
export interface PostView {
  id: string
  status: PostStatus
  format: PostFormat
  caption: string
  media: PostMedia[]
  product_id: string | null
  product_name: string | null
  link_url: string | null
  targets: Target[]
  scheduled_at: string | null
  published_at: string | null
  origin: PostOrigin
  results: Partial<Record<Target, TargetResult>>
  last_error: string | null
  share_token: string
  created_at: string
}

const POST_SELECT = {
  id: true,
  status: true,
  format: true,
  caption: true,
  media: true,
  product_id: true,
  link_url: true,
  targets: true,
  scheduled_at: true,
  published_at: true,
  origin: true,
  results: true,
  last_error: true,
  share_token: true,
  created_at: true,
  products: { select: { name: true } },
} as const

type PostRow = {
  id: string
  status: string
  format: string
  caption: string
  media: unknown
  product_id: string | null
  link_url: string | null
  targets: string[]
  scheduled_at: string | Date | null
  published_at: string | Date | null
  origin: string
  results: unknown
  last_error: string | null
  share_token: string
  created_at: string | Date
  products?: { name: string } | null
}

const iso = (v: string | Date | null) => (v === null ? null : typeof v === 'string' ? v : v.toISOString())

function view(r: PostRow): PostView {
  return {
    id: r.id,
    status: r.status as PostStatus,
    format: r.format as PostFormat,
    caption: r.caption,
    media: (Array.isArray(r.media) ? r.media : []) as PostMedia[],
    product_id: r.product_id,
    product_name: r.products?.name ?? null,
    link_url: r.link_url,
    targets: r.targets as Target[],
    scheduled_at: iso(r.scheduled_at),
    published_at: iso(r.published_at),
    origin: r.origin as PostOrigin,
    results: (r.results && typeof r.results === 'object' ? r.results : {}) as PostView['results'],
    last_error: r.last_error,
    share_token: r.share_token,
    created_at: iso(r.created_at)!,
  }
}

export async function listPosts(workspaceId: string, f: { from?: Date; to?: Date; status?: PostStatus[] }): Promise<PostView[]> {
  const rows = await tenantDb(workspaceId).social_posts.findMany({
    where: {
      ...(f.status?.length ? { status: { in: f.status } } : {}),
      ...(f.from || f.to
        ? { OR: [{ scheduled_at: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } }, { scheduled_at: null }] }
        : {}),
    },
    select: POST_SELECT,
    orderBy: [{ scheduled_at: { sort: 'desc', nulls: 'first' } }, { created_at: 'desc' }],
    take: 300,
  })
  return rows.map((r) => view(r as PostRow))
}

export async function getPost(workspaceId: string, id: string): Promise<PostView | null> {
  const r = await tenantDb(workspaceId).social_posts.findFirst({ where: { id }, select: POST_SELECT })
  return r ? view(r as PostRow) : null
}

/** Accounts the post needs and the business hasn't connected (or set up). */
export async function missingFor(ws: SocialWorkspace, targets: Target[]): Promise<Target[]> {
  const accounts = await listAccounts(ws.id)
  const s = socialSettingsOf(ws)
  return targets.filter((t) => (t === 'whatsapp_status' ? !s.status_phones.length : !accounts.some((a) => a.network === t)))
}

const newToken = () => crypto.randomBytes(12).toString('base64url')

export async function createPost(ws: SocialWorkspace, userId: string | null, input: PostInput, extra: { origin?: PostOrigin; status?: PostStatus; slot_key?: string } = {}): Promise<PostView> {
  const status: PostStatus = extra.status ?? (input.draft ? 'draft' : 'scheduled')
  const at = input.scheduled_at ? new Date(input.scheduled_at) : status === 'scheduled' ? new Date() : null
  const row = await tenantDb(ws.id).social_posts.create({
    data: {
      workspace_id: ws.id,
      status,
      format: input.format,
      caption: input.caption,
      media: input.media as unknown as Prisma.InputJsonValue,
      product_id: input.product_id,
      link_url: input.link_url,
      targets: input.targets,
      scheduled_at: at,
      origin: extra.origin ?? 'manual',
      slot_key: extra.slot_key ?? null,
      share_token: newToken(),
      created_by: userId,
      approved_by: status === 'scheduled' ? userId : null,
    },
    select: POST_SELECT,
  })
  if (status === 'scheduled' && at && at.getTime() <= Date.now() + 60_000) kickPublish(ws.id, row.id)
  return view(row as PostRow)
}

const EDITABLE: PostStatus[] = ['draft', 'pending_approval', 'scheduled', 'failed', 'cancelled']

export type EditResult = { ok: true; post: PostView } | { ok: false; error: 'not_found' | 'not_editable' }

export async function updatePost(ws: SocialWorkspace, userId: string, id: string, input: PostInput): Promise<EditResult> {
  const db = tenantDb(ws.id)
  const cur = await db.social_posts.findFirst({ where: { id }, select: { status: true, origin: true } })
  if (!cur) return { ok: false, error: 'not_found' }
  if (!EDITABLE.includes(cur.status as PostStatus)) return { ok: false, error: 'not_editable' }
  // Editing an automatic post the business still has to approve keeps it waiting, unless they schedule it.
  const status: PostStatus = input.draft ? (cur.status === 'pending_approval' ? 'pending_approval' : 'draft') : 'scheduled'
  const at = input.scheduled_at ? new Date(input.scheduled_at) : status === 'scheduled' ? new Date() : null
  await db.social_posts.updateMany({
    where: { id, status: { in: EDITABLE } },
    data: {
      status,
      format: input.format,
      caption: input.caption,
      media: input.media as unknown as Prisma.InputJsonValue,
      product_id: input.product_id,
      link_url: input.link_url,
      targets: input.targets,
      scheduled_at: at,
      results: {},
      attempts: 0,
      last_error: null,
      ...(status === 'scheduled' ? { approved_by: userId } : {}),
      updated_at: new Date(),
    },
  })
  if (status === 'scheduled' && at && at.getTime() <= Date.now() + 60_000) kickPublish(ws.id, id)
  return { ok: true, post: (await getPost(ws.id, id))! }
}

export type ActionResult = { ok: true; post: PostView } | { ok: false; error: 'not_found' | 'invalid_state' }

/** approve: pending → scheduled (now if its time passed). retry: failed/partial → again (only what failed). cancel. */
export async function postAction(ws: SocialWorkspace, userId: string, id: string, action: 'approve' | 'retry' | 'cancel' | 'publish_now'): Promise<ActionResult> {
  const db = tenantDb(ws.id)
  const cur = await db.social_posts.findFirst({ where: { id }, select: { status: true, scheduled_at: true } })
  if (!cur) return { ok: false, error: 'not_found' }
  const st = cur.status as PostStatus
  const now = new Date()
  let data: Prisma.social_postsUncheckedUpdateManyInput
  let allowed: PostStatus[]
  if (action === 'approve') {
    allowed = ['pending_approval', 'draft']
    const at = cur.scheduled_at ? new Date(cur.scheduled_at) : now
    data = { status: 'scheduled', approved_by: userId, scheduled_at: at < now ? now : at }
  } else if (action === 'publish_now') {
    allowed = ['pending_approval', 'draft', 'scheduled']
    data = { status: 'scheduled', approved_by: userId, scheduled_at: now }
  } else if (action === 'retry') {
    allowed = ['failed', 'partial']
    data = { status: 'scheduled', scheduled_at: now, attempts: 0, last_error: null }
  } else {
    allowed = ['pending_approval', 'draft', 'scheduled', 'failed']
    data = { status: 'cancelled' }
  }
  if (!allowed.includes(st)) return { ok: false, error: 'invalid_state' }
  const { count } = await db.social_posts.updateMany({ where: { id, status: st }, data: { ...data, updated_at: now } })
  if (!count) return { ok: false, error: 'invalid_state' }
  if (action !== 'cancel') {
    const p = await db.social_posts.findFirst({ where: { id }, select: { scheduled_at: true } })
    if (p?.scheduled_at && new Date(p.scheduled_at).getTime() <= Date.now() + 60_000) kickPublish(ws.id, id)
  }
  return { ok: true, post: (await getPost(ws.id, id))! }
}

export async function deletePost(workspaceId: string, id: string): Promise<boolean> {
  const { count } = await tenantDb(workspaceId).social_posts.deleteMany({ where: { id, status: { not: 'publishing' } } })
  return count > 0
}

// ------------------------------------------------------------------
// Publishing
// ------------------------------------------------------------------

/** Instagram takes JPEG photos only: other formats get a JPEG copy in the social bucket. */
async function jpegFor(workspaceId: string, url: string): Promise<string> {
  if (/\.jpe?g(\?|$)/i.test(url)) return url
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 24)
  const out = `${workspaceId}/ig/${hash}.jpg`
  let input: Buffer
  const own = (['catalog', 'social'] as const).map((b) => [b, storagePathFromUrl(url, b)] as const).find(([, p]) => !!p)
  if (own) input = (await downloadObject(own[0], own[1]!)).body
  else {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`image_download_${res.status}`)
    input = Buffer.from(await res.arrayBuffer())
  }
  const jpg = await sharp(input).rotate().flatten({ background: '#ffffff' }).jpeg({ quality: 90 }).toBuffer()
  await uploadObject('social', out, jpg, 'image/jpeg', { upsert: true })
  return publicUrl('social', out)
}

const errText = (err: unknown) => (err instanceof SocialGraphError && err.auth ? 'auth' : err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300))

async function markAccountError(workspaceId: string, accountId: string, err: unknown) {
  if (err instanceof SocialGraphError && err.auth) {
    await tenantDb(workspaceId).social_accounts.updateMany({ where: { id: accountId }, data: { status: 'error', last_error: err.message.slice(0, 300), updated_at: new Date() } }).catch(() => undefined)
  }
}

const running = new Set<string>()
/** Instagram videos still processing are checked on the next runs, up to this many times. */
const MAX_IG_CHECKS = 12

/** Publishes one due post to each destination still pending. Never throws. */
export async function publishPost(workspaceId: string, id: string): Promise<PostStatus | null> {
  if (running.has(id)) return null
  running.add(id)
  try {
    return await publish(workspaceId, id)
  } catch (err) {
    console.error('[social] publish failed:', err instanceof Error ? err.message : err)
    await tenantDb(workspaceId).social_posts.updateMany({ where: { id, status: 'publishing' }, data: { status: 'failed', last_error: errText(err), updated_at: new Date() } }).catch(() => undefined)
    return 'failed'
  } finally {
    running.delete(id)
  }
}

async function publish(workspaceId: string, id: string): Promise<PostStatus | null> {
  const db = tenantDb(workspaceId)
  const now = new Date()
  // Claim it (scheduled and due) or continue it (publishing with Instagram still processing).
  const claimed = await db.social_posts.updateMany({
    where: { id, OR: [{ status: 'scheduled', scheduled_at: { lte: new Date(now.getTime() + 60_000) } }, { status: 'publishing', updated_at: { lt: new Date(now.getTime() - 60_000) } }] },
    data: { status: 'publishing', attempts: { increment: 1 }, updated_at: now },
  })
  if (!claimed.count) return null
  const ws = await loadSocialWorkspace(workspaceId)
  const row = await db.social_posts.findFirst({ where: { id }, select: { ...POST_SELECT, attempts: true } })
  if (!ws || !row) return null
  const post = view(row as PostRow)
  const results: Partial<Record<Target, TargetResult>> = { ...post.results }
  const settings = socialSettingsOf(ws)
  const link = post.link_url ?? productLink(ws, post.product_id)
  const media = post.media.map((m) => ({ ...m, url: absolute(m.url) }))
  const stamp = () => new Date().toISOString()

  for (const target of post.targets) {
    const prev = results[target]
    if (prev?.status === 'published' || prev?.status === 'sent') continue
    if (target === 'whatsapp_status') {
      results[target] = await sendStatusPost({
        workspace: ws,
        phones: settings.status_phones,
        channelId: settings.status_channel_id,
        media,
        caption: captionFor(target, post.caption, link),
        shareToken: post.share_token,
      })
      continue
    }
    const account = await accountFor(ws.id, target)
    if (!account) {
      results[target] = { status: 'failed', error: 'not_connected', at: stamp() }
      continue
    }
    const caption = captionFor(target, post.caption, link)
    try {
      if (target === 'facebook') {
        const r = await publishFacebook({ id: account.external_id, token: account.token }, post.format, media, caption)
        results[target] = { status: 'published', id: r.id, url: r.url, at: stamp() }
        continue
      }
      const ig = { id: account.external_id, token: account.token }
      let container = prev?.status === 'processing' ? prev.container ?? null : null
      let ready = false
      if (container) {
        const s = await containerStatus(container, account.token)
        if (s === 'ERROR' || s === 'EXPIRED') throw new SocialGraphError(s === 'ERROR' ? 'instagram_media_error' : 'instagram_media_expired')
        ready = s === 'FINISHED' || s === 'PUBLISHED'
      } else {
        const igMedia = await Promise.all(media.map(async (m) => (m.type === 'image' ? { ...m, url: await jpegFor(ws.id, m.url) } : m)))
        const r = await prepareInstagram(ig, post.format, igMedia, caption)
        container = r.container
        ready = r.ready
      }
      if (!ready) {
        results[target] =
          (row.attempts ?? 0) >= MAX_IG_CHECKS ? { status: 'failed', error: 'instagram_video_slow', at: stamp() } : { status: 'processing', container, at: stamp() }
        continue
      }
      const r = await publishInstagramContainer(ig, container)
      results[target] = { status: 'published', id: r.id, url: r.url, at: stamp() }
    } catch (err) {
      await markAccountError(ws.id, account.id, err)
      results[target] = { status: 'failed', error: errText(err), at: stamp() }
    }
  }

  const status = overallStatus(post.targets, results)
  const failed = post.targets.map((t) => results[t]).find((r) => r?.status === 'failed')
  await db.social_posts.updateMany({
    where: { id },
    data: {
      status,
      results: results as unknown as Prisma.InputJsonValue,
      last_error: failed?.error ?? null,
      ...(status === 'published' || status === 'partial' ? { published_at: new Date() } : {}),
      updated_at: new Date(),
    },
  })
  if (status === 'failed' || status === 'partial') await notifyAdmins(ws, 'failed', id)
  return status
}

export function kickPublish(workspaceId: string, id: string): void {
  try {
    after(() => publishPost(workspaceId, id).then(() => undefined))
  } catch {
    void publishPost(workspaceId, id)
  }
}

async function notifyAdmins(ws: SocialWorkspace, kind: 'failed' | 'approve', postId: string) {
  const db = tenantDb(ws.id)
  const members = await db.workspace_members.findMany({ where: { status: 'active', role: { in: ['owner', 'admin'] } }, select: { user_id: true } }).catch(() => [])
  if (!members.length) return
  const es = ws.locale !== 'en'
  const title =
    kind === 'failed'
      ? es ? 'Una publicación no se pudo publicar' : 'A post could not be published'
      : es ? 'Hay publicaciones por aprobar' : 'Posts waiting for approval'
  const body =
    kind === 'failed'
      ? es ? 'Revisa el motivo en Publicaciones y vuelve a intentarlo.' : 'See why in Posts and try again.'
      : es ? 'Whasalia preparó publicaciones automáticas. Revísalas y apruébalas en Publicaciones.' : 'Whasalia prepared automatic posts. Review and approve them in Posts.'
  await db.notifications
    .createMany({ data: members.map((m) => ({ workspace_id: ws.id, user_id: m.user_id, type: 'system', title, body, link: `/posts?post=${postId}` })) })
    .catch((err) => console.warn('[social] notify failed:', err instanceof Error ? err.message : err))
}

// ------------------------------------------------------------------
// Automatic posts
// ------------------------------------------------------------------
type ProductForPost = { id: string; name: string; description: string | null; price: unknown; compare_at_price: unknown; images: string[]; is_active: boolean }

async function autoCaption(ws: SocialWorkspace, s: SocialSettings, product: ProductForPost, format: PostFormat, targets: Target[], origin: PostOrigin): Promise<string> {
  const input: CaptionInput = {
    workspace: ws,
    product: {
      name: product.name,
      description: product.description,
      price: product.price == null ? null : Number(product.price),
      compare_at_price: product.compare_at_price == null ? null : Number(product.compare_at_price),
    },
    link: productLink(ws, product.id),
    format,
    targets,
    instructions: s.caption_instructions,
    origin,
  }
  try {
    return await writeCaption(input)
  } catch (err) {
    console.warn('[social] auto caption without AI:', err instanceof Error ? err.message : err)
    return fallbackCaption(input)
  }
}

async function autoPost(ws: SocialWorkspace, product: ProductForPost, opts: { origin: PostOrigin; format: 'post' | 'story'; targets: Target[]; at: Date; slot_key?: string }): Promise<PostView | null> {
  const s = socialSettingsOf(ws)
  const targets = opts.targets.filter((t) => !(t === 'whatsapp_status' && !s.status_phones.length))
  const images = product.images.slice(0, opts.format === 'story' ? 1 : 10).map((url) => ({ url: absolute(url), type: 'image' as const }))
  if (!targets.length || !images.length) return null
  const accounts = await listAccounts(ws.id)
  const usable = targets.filter((t) => t === 'whatsapp_status' || accounts.some((a) => a.network === t))
  if (!usable.length) return null
  const caption = await autoCaption(ws, s, product, opts.format, usable, opts.origin)
  try {
    const post = await createPost(
      ws,
      null,
      { format: opts.format, caption, media: images, targets: usable, product_id: product.id, link_url: null, scheduled_at: opts.at.toISOString(), draft: false },
      { origin: opts.origin, status: s.approval === 'auto' ? 'scheduled' : 'pending_approval', slot_key: opts.slot_key },
    )
    if (post.status === 'pending_approval') await notifyAdmins(ws, 'approve', post.id)
    return post
  } catch (err) {
    // Same calendar slot made twice at once (unique index): already there.
    if ((err as { code?: string })?.code === 'P2002') return null
    throw err
  }
}

const PRODUCT_SELECT = { id: true, name: true, description: true, price: true, compare_at_price: true, images: true, is_active: true } as const

/** New product or back in stock: an automatic post when the business turned it on. Never throws. */
export async function onProductEvent(workspaceId: string, productId: string, event: 'new_product' | 'restock'): Promise<void> {
  try {
    const ws = await loadSocialWorkspace(workspaceId)
    if (!ws) return
    const s = socialSettingsOf(ws)
    if (event === 'new_product' ? !s.auto_new_product : !s.auto_restock) return
    const product = await tenantDb(workspaceId).products.findFirst({ where: { id: productId }, select: PRODUCT_SELECT })
    if (!product?.is_active || !product.images.length) return
    // Once a day per product and event, at most.
    const recent = await tenantDb(workspaceId).social_posts.findFirst({
      where: { product_id: productId, origin: event, created_at: { gt: new Date(Date.now() - 86_400_000) } },
      select: { id: true },
    })
    if (recent) return
    await autoPost(ws, product, { origin: event, format: s.auto_format, targets: s.auto_targets, at: new Date(Date.now() + AUTO_DELAY_MINUTES * 60_000) })
  } catch (err) {
    console.error('[social] automatic post failed:', err instanceof Error ? err.message : err)
  }
}

export function kickProductEvent(workspaceId: string, productId: string, event: 'new_product' | 'restock'): void {
  try {
    after(() => onProductEvent(workspaceId, productId, event))
  } catch {
    void onProductEvent(workspaceId, productId, event)
  }
}

/** Units left of a product (null = doesn't track stock). */
export async function productAvailable(workspaceId: string, productId: string): Promise<number | null> {
  const p = await tenantDb(workspaceId).products.findFirst({
    where: { id: productId },
    select: { track_stock: true, stock: true, product_variants: { where: { is_active: true }, select: { stock: true } } },
  })
  if (!p || !p.track_stock) return null
  if (p.product_variants.length) return p.product_variants.reduce((n, v) => n + Math.max(0, v.stock ?? 0), 0)
  return Math.max(0, p.stock ?? 0)
}

/** Calendar slots of the next 24 h: one post each, with the product posted least recently. */
async function fillCalendar(ws: SocialWorkspace): Promise<number> {
  const s = socialSettingsOf(ws)
  if (!s.calendar.enabled || !s.calendar.slots.length) return 0
  const db = tenantDb(ws.id)
  const slots = upcomingSlots(s.calendar.slots, ws.timezone, new Date(), 24)
  let made = 0
  for (const slot of slots) {
    if (await db.social_posts.findFirst({ where: { slot_key: slot.key }, select: { id: true } })) continue
    const products = await db.products.findMany({ where: { is_active: true, images: { isEmpty: false } }, select: PRODUCT_SELECT, take: 500 })
    if (!products.length) return made
    const last = await db.social_posts.groupBy({ by: ['product_id'], where: { product_id: { in: products.map((p) => p.id) } }, _max: { created_at: true } })
    const lastAt = new Map(last.map((l) => [l.product_id, l._max.created_at ? new Date(l._max.created_at).getTime() : 0]))
    const pick = [...products].sort((a, b) => (lastAt.get(a.id) ?? 0) - (lastAt.get(b.id) ?? 0) || a.name.localeCompare(b.name))[0]
    if (await autoPost(ws, pick, { origin: 'calendar', format: s.calendar.format, targets: s.calendar.targets, at: slot.at, slot_key: slot.key })) made++
  }
  return made
}

// ------------------------------------------------------------------
// Cron
// ------------------------------------------------------------------
export async function runSocialCron(): Promise<{ published: number; failed: number; calendar: number }> {
  const out = { published: 0, failed: 0, calendar: 0 }
  const now = Date.now()
  const due = await prisma.social_posts
    .findMany({
      where: {
        OR: [
          { status: 'scheduled', scheduled_at: { lte: new Date(now + 60_000) } },
          // Instagram still processing, or a run that died halfway.
          { status: 'publishing', updated_at: { lt: new Date(now - 60_000) } },
        ],
      },
      select: { id: true, workspace_id: true },
      orderBy: { scheduled_at: 'asc' },
      take: 25,
    })
    .catch(() => [])
  for (const p of due) {
    const st = await publishPost(p.workspace_id, p.id)
    if (st === 'published') out.published++
    else if (st === 'failed' || st === 'partial') out.failed++
  }
  const withCalendar = await prisma.workspaces
    .findMany({ where: { settings: { path: ['social', 'calendar', 'enabled'], equals: true } }, select: WS_SELECT, take: 200 })
    .catch(() => [])
  for (const w of withCalendar) {
    try {
      out.calendar += await fillCalendar({ ...w, settings: (w.settings ?? {}) as Record<string, unknown> })
    } catch (err) {
      console.error('[social] calendar failed:', err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** Public page of a post for WhatsApp status (by its share token). */
export async function postByShareToken(token: string): Promise<{ post: PostView; business: string; locale: 'es' | 'en' } | null> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(token)) return null
  const r = await prisma.social_posts.findFirst({
    where: { share_token: token, status: { notIn: ['cancelled'] } },
    select: { ...POST_SELECT, workspaces: { select: { name: true, locale: true } } },
  })
  if (!r) return null
  return { post: view(r as PostRow), business: r.workspaces.name, locale: r.workspaces.locale === 'en' ? 'en' : 'es' }
}
