import 'server-only'
import { randomUUID } from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { loadChannel } from '@/lib/channels/store'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import { productAttributesFor, validateAttributes } from '@/lib/catalog/attributes'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { isUuid } from '@/lib/workspace/constants'
import type { Locale } from '@/lib/industries'
import {
  OPEN_CAPTURE_STATUSES,
  captureAttributes,
  captureTitle,
  classifyPhotoRef,
  normalizeCaptureFields,
  type CaptureSource,
  type PropertyCapture,
} from './captures-core'

export * from './captures-core'

const CATALOG_BUCKET = 'catalog'
const ATTACHMENTS_BUCKET = 'attachments'
const MAX_PHOTO_BYTES = 8 * 1024 * 1024

export interface CreateCaptureInput {
  workspaceId: string
  contactId?: string | null
  conversationId?: string | null
  /** Raw fields (snake_case, as in CaptureFields); validated here. */
  fields?: Record<string, unknown>
  source?: CaptureSource
  /** Auth user who created it (manual captures). */
  createdBy?: string | null
  /** Notify workspace admins (and the assignee) about the new capture. Default: source === 'ai'. */
  notify?: boolean
}

export type CreateCaptureResult =
  | { ok: true; capture: PropertyCapture; created: boolean }
  | { ok: false; error: 'invalid'; errors: Record<string, string> }
  | { ok: false; error: 'not_found' | 'failed'; detail?: string }

/**
 * Records an owner who wants to sell/rent their property through the agency.
 * For the AI agent: when the conversation already has an open capture
 * (new/contacted/evaluated/signed) it is updated with the new non-empty
 * fields (photos are appended) instead of creating a duplicate.
 * Owner name/phone default to the contact's.
 */
export async function createCapture(input: CreateCaptureInput): Promise<CreateCaptureResult> {
  const db = supabaseAdmin()
  const ws = input.workspaceId
  if (!isUuid(ws)) return { ok: false, error: 'not_found' }
  const source: CaptureSource = input.source === 'ai' ? 'ai' : 'manual'
  const { values, errors } = normalizeCaptureFields(input.fields ?? {})
  if (Object.keys(errors).length) return { ok: false, error: 'invalid', errors }
  // Status / assignment / publication are not set through creation by the AI.
  if (source === 'ai') {
    delete values.status
    delete values.assigned_user_id
  }
  if (values.status === 'published') delete values.status

  const { data: workspace } = await db.from('workspaces').select('id, currency').eq('id', ws).maybeSingle()
  if (!workspace) return { ok: false, error: 'not_found' }

  // Links must belong to the workspace.
  let contactId = isUuid(input.contactId ?? null) ? input.contactId! : null
  const conversationId = isUuid(input.conversationId ?? null) ? input.conversationId! : null
  if (conversationId) {
    const { data: conv } = await db.from('conversations').select('id, contact_id').eq('workspace_id', ws).eq('id', conversationId).maybeSingle()
    if (!conv) return { ok: false, error: 'not_found', detail: 'conversation' }
    contactId = contactId ?? conv.contact_id ?? null
  }
  let contact: { name: string | null; phone: string | null } | null = null
  if (contactId) {
    const { data } = await db.from('contacts').select('id, name, phone').eq('workspace_id', ws).eq('id', contactId).maybeSingle()
    if (!data) return { ok: false, error: 'not_found', detail: 'contact' }
    contact = { name: data.name ?? null, phone: data.phone ?? null }
  }
  if (values.assigned_user_id) {
    const { data: m } = await db
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', ws)
      .eq('user_id', values.assigned_user_id)
      .eq('status', 'active')
      .maybeSingle()
    if (!m) return { ok: false, error: 'invalid', errors: { assigned_user_id: 'invalid' } }
  }

  // Merge into the open capture of the same conversation.
  if (conversationId) {
    const { data: open } = await db
      .from('property_captures')
      .select('*')
      .eq('workspace_id', ws)
      .eq('conversation_id', conversationId)
      .in('status', OPEN_CAPTURE_STATUSES)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (open) {
      const patch: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(values)) {
        if (k === 'photos') continue
        if (v !== null && v !== undefined && v !== '') patch[k] = v
      }
      if (values.photos?.length) {
        patch.photos = [...new Set([...(open.photos ?? []), ...values.photos])].slice(0, 30)
      }
      if (!Object.keys(patch).length) return { ok: true, capture: open as PropertyCapture, created: false }
      const { data, error } = await db.from('property_captures').update(patch).eq('id', open.id).eq('workspace_id', ws).select('*').single()
      if (error) return { ok: false, error: 'failed', detail: error.message }
      return { ok: true, capture: data as PropertyCapture, created: false }
    }
  }

  const row = {
    workspace_id: ws,
    contact_id: contactId,
    conversation_id: conversationId,
    ...values,
    owner_name: values.owner_name ?? contact?.name ?? null,
    owner_phone: values.owner_phone ?? contact?.phone ?? null,
    currency: values.currency ?? (values.expected_price != null ? workspace.currency : null),
    photos: values.photos ?? [],
    source,
    created_by: input.createdBy ?? null,
  }
  const { data, error } = await db.from('property_captures').insert(row).select('*').single()
  if (error) return { ok: false, error: 'failed', detail: error.message }
  const capture = data as PropertyCapture
  if (input.notify ?? source === 'ai') await notifyNewCapture(capture, input.createdBy ?? null)
  return { ok: true, capture, created: true }
}

/** In-app notification for admins/owners (and the assignee) about a new capture. Never throws. */
async function notifyNewCapture(c: PropertyCapture, actorId: string | null): Promise<void> {
  try {
    const db = supabaseAdmin()
    const [{ data: members }, { data: ws }] = await Promise.all([
      db.from('workspace_members').select('user_id, role').eq('workspace_id', c.workspace_id).eq('status', 'active'),
      db.from('workspaces').select('locale').eq('id', c.workspace_id).maybeSingle(),
    ])
    const locale: Locale = ws?.locale === 'en' ? 'en' : 'es'
    const targets = new Set<string>()
    for (const m of members ?? []) if (m.role === 'owner' || m.role === 'admin') targets.add(m.user_id)
    if (c.assigned_user_id) targets.add(c.assigned_user_id)
    if (actorId) targets.delete(actorId)
    if (!targets.size) return
    const title = locale === 'en' ? 'New property intake' : 'Nueva captación de propiedad'
    const body = [c.owner_name, captureTitle(c, locale)].filter(Boolean).join(' — ')
    await db.from('notifications').insert(
      [...targets].map((userId) => ({
        workspace_id: c.workspace_id,
        user_id: userId,
        type: 'system',
        title,
        body: body.slice(0, 280),
        link: `/captures?id=${c.id}`,
        conversation_id: c.conversation_id,
        actor_id: actorId,
      })),
    )
  } catch (err) {
    console.warn('[captures] notify failed:', err instanceof Error ? err.message : err)
  }
}

/** Partial update (validated). Returns the updated row or an error. */
export async function updateCapture(
  workspaceId: string,
  id: string,
  raw: Record<string, unknown>,
): Promise<{ ok: true; capture: PropertyCapture } | { ok: false; error: 'invalid' | 'not_found' | 'failed'; errors?: Record<string, string> }> {
  if (!isUuid(id)) return { ok: false, error: 'not_found' }
  const { values, errors } = normalizeCaptureFields(raw)
  if (values.status === 'published') errors.status = 'invalid'
  if (Object.keys(errors).length) return { ok: false, error: 'invalid', errors }
  const db = supabaseAdmin()
  if (values.assigned_user_id) {
    const { data: m } = await db
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', values.assigned_user_id)
      .eq('status', 'active')
      .maybeSingle()
    if (!m) return { ok: false, error: 'invalid', errors: { assigned_user_id: 'invalid' } }
  }
  const patch = values as Record<string, unknown>
  if (!Object.keys(patch).length) {
    const { data } = await db.from('property_captures').select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
    return data ? { ok: true, capture: data as PropertyCapture } : { ok: false, error: 'not_found' }
  }
  const { data, error } = await db.from('property_captures').update(patch).eq('workspace_id', workspaceId).eq('id', id).select('*').maybeSingle()
  if (error) return { ok: false, error: 'failed' }
  if (!data) return { ok: false, error: 'not_found' }
  return { ok: true, capture: data as PropertyCapture }
}

// ------------------------------------------------------------------
// Photos
// ------------------------------------------------------------------

/** URLs the browser can show for each stored photo reference (signed for private ones). */
export async function displayPhotoUrls(refs: string[]): Promise<string[]> {
  const db = supabaseAdmin()
  const attachmentPaths = refs.map((r) => classifyPhotoRef(r)).filter((p) => p?.kind === 'attachment').map((p) => (p as { path: string }).path)
  const signed = new Map<string, string>()
  if (attachmentPaths.length) {
    const { data } = await db.storage.from(ATTACHMENTS_BUCKET).createSignedUrls(attachmentPaths, 3600)
    for (const s of data ?? []) if (s.path && s.signedUrl) signed.set(s.path, s.signedUrl)
  }
  return refs.map((r) => {
    const p = classifyPhotoRef(r)
    if (!p) return ''
    if (p.kind === 'attachment') return signed.get(p.path) ?? ''
    return p.url
  })
}

const sniff = (b: Uint8Array): { type: string; ext: string } | null => {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' }
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { type: 'image/png', ext: 'png' }
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { type: 'image/gif', ext: 'gif' }
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    return { type: 'image/webp', ext: 'webp' }
  }
  return null
}

/** Public https host only (no IP literals / localhost) for external downloads. */
function fetchableExternal(url: string): boolean {
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:') return false
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal')) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(':')) return false
    return true
  } catch {
    return false
  }
}

async function photoBytes(workspaceId: string, ref: string): Promise<Uint8Array | null> {
  const p = classifyPhotoRef(ref)
  if (!p) return null
  const db = supabaseAdmin()
  try {
    if (p.kind === 'attachment' || p.kind === 'catalog') {
      // Only objects of this workspace.
      if (!p.path.startsWith(`${workspaceId}/`)) return null
      const { data, error } = await db.storage.from(p.kind === 'attachment' ? ATTACHMENTS_BUCKET : CATALOG_BUCKET).download(p.path)
      if (error || !data) return null
      return new Uint8Array(await data.arrayBuffer())
    }
    if (p.kind === 'proxy') {
      const channel = await loadChannel(workspaceId, p.channelId)
      const token = channel?.type === 'whatsapp' ? channel.secrets.access_token : null
      if (!token) return null
      const info = await getMediaUrl({ mediaId: p.mediaId, accessToken: token })
      const { buffer } = await downloadMedia({ downloadUrl: info.url, accessToken: token })
      return new Uint8Array(buffer)
    }
    if (!fetchableExternal(p.url)) return null
    const res = await fetch(p.url, { signal: AbortSignal.timeout(15_000), redirect: 'follow' })
    if (!res.ok) return null
    const len = Number(res.headers.get('content-length') ?? 0)
    if (len > MAX_PHOTO_BYTES) return null
    return new Uint8Array(await res.arrayBuffer())
  } catch {
    return null
  }
}

/** Copies the capture photos into the public catalog bucket. Returns public URLs + failures count. */
async function copyPhotosToCatalog(workspaceId: string, refs: string[]): Promise<{ urls: string[]; paths: string[]; failed: number }> {
  const db = supabaseAdmin()
  const urls: string[] = []
  const paths: string[] = []
  let failed = 0
  for (const ref of refs) {
    const bytes = await photoBytes(workspaceId, ref)
    const kind = bytes && bytes.byteLength <= MAX_PHOTO_BYTES ? sniff(bytes) : null
    if (!bytes || !kind) {
      failed++
      continue
    }
    const path = `${workspaceId}/products/${randomUUID()}.${kind.ext}`
    const { error } = await db.storage.from(CATALOG_BUCKET).upload(path, bytes, { contentType: kind.type, upsert: false })
    if (error) {
      failed++
      continue
    }
    paths.push(path)
    urls.push(db.storage.from(CATALOG_BUCKET).getPublicUrl(path).data.publicUrl)
  }
  return { urls, paths, failed }
}

export type PublishResult =
  | { ok: true; productId: string; capture: PropertyCapture; photosFailed: number }
  | { ok: false; error: 'not_found' | 'already_published' | 'failed'; detail?: string }

/**
 * "Publicar como propiedad": creates an active listing (products row) from
 * the capture — title, description, expected price in the capture's
 * currency (products.currency, NULL when it is the workspace currency),
 * preset attributes and photos copied to the catalog
 * bucket — then links it (product_id) and marks the capture published.
 */
export async function publishCapture(workspaceId: string, captureId: string, userId: string | null): Promise<PublishResult> {
  if (!isUuid(captureId)) return { ok: false, error: 'not_found' }
  const db = supabaseAdmin()
  const [{ data: cap }, { data: ws }] = await Promise.all([
    db.from('property_captures').select('*').eq('workspace_id', workspaceId).eq('id', captureId).maybeSingle(),
    db.from('workspaces').select('id, industry, currency, locale, settings').eq('id', workspaceId).maybeSingle(),
  ])
  if (!cap || !ws) return { ok: false, error: 'not_found' }
  const c = cap as PropertyCapture
  if (c.product_id) return { ok: false, error: 'already_published' }

  const locale: Locale = ws.locale === 'en' ? 'en' : 'es'
  const price = c.expected_price != null ? Number(c.expected_price) : null
  const cur = c.currency?.toUpperCase() || null
  const currency = price !== null && cur && cur !== ws.currency ? cur : null
  const description = c.description?.trim() || null

  const fields = productAttributesFor(ws.industry, ws.settings)
  const { values: attributes } = validateAttributes(fields, captureAttributes(c))

  const photos = await copyPhotosToCatalog(workspaceId, c.photos ?? [])
  const { data: product, error } = await db
    .from('products')
    .insert({
      workspace_id: workspaceId,
      name: captureTitle(c, locale),
      description,
      price,
      currency,
      images: photos.urls,
      attributes,
      is_active: true,
      created_by: userId,
    })
    .select('id')
    .single()
  if (error || !product) {
    if (photos.paths.length) await db.storage.from(CATALOG_BUCKET).remove(photos.paths)
    return { ok: false, error: 'failed', detail: error?.message }
  }

  // Link only if still unpublished (concurrent publish → keep the first).
  const { data: updated } = await db
    .from('property_captures')
    .update({ product_id: product.id, status: 'published', published_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', captureId)
    .is('product_id', null)
    .select('*')
    .maybeSingle()
  if (!updated) {
    await db.from('products').delete().eq('workspace_id', workspaceId).eq('id', product.id)
    if (photos.paths.length) await db.storage.from(CATALOG_BUCKET).remove(photos.paths)
    return { ok: false, error: 'already_published' }
  }
  invalidateBusinessContext(workspaceId)
  return { ok: true, productId: product.id, capture: updated as PropertyCapture, photosFailed: photos.failed }
}

