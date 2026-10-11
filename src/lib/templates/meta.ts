import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { getMetaConfig } from '@/lib/platform/meta'
import { downloadObject } from '@/lib/storage'
import { storagePathFromUrl } from '@/lib/storage/paths'
import type { LoadedChannel } from '@/lib/channels/types'
import { toMetaPayload, type TemplateDraft, type TemplateVariable } from './model'

// Template submission through the WhatsApp Business Management API:
//   POST   /{waba-id}/message_templates            create (Meta reviews it)
//   POST   /{template-id}                          edit (goes back to review)
//   DELETE /{waba-id}/message_templates?name&hsm_id
// Media headers need a sample uploaded with the Resumable Upload API
// (/{app-id}/uploads) — the handle goes in the template's example.
// Review results arrive by webhook (message_template_status_update).

export class MetaTemplateError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message)
  }
}

async function graph(path: string, token: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  const { graphBase } = await getMetaConfig()
  const res = await fetch(`${graphBase}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init.body && !(init.body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    signal: AbortSignal.timeout(30_000),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string; error_user_msg?: string; error_user_title?: string; code?: number } }
  if (!res.ok || body.error) {
    const e = body.error
    throw new MetaTemplateError(e?.error_user_msg || e?.message || `Meta API error ${res.status}`, e?.code)
  }
  return body
}

function channelAuth(channel: LoadedChannel): { token: string; wabaId: string } {
  const token = channel.secrets.access_token
  const wabaId = typeof channel.settings?.waba_id === 'string' ? channel.settings.waba_id : ''
  if (channel.type !== 'whatsapp' || !token) throw new MetaTemplateError('whatsapp_not_connected')
  if (!wabaId) throw new MetaTemplateError('waba_missing')
  return { token, wabaId }
}

/** Uploads the header sample (our stored file) and returns Meta's handle. */
async function uploadHeaderSample(mediaUrl: string, token: string): Promise<string> {
  const { appId } = await getMetaConfig()
  if (!appId) throw new MetaTemplateError('app_id_missing')
  const path = storagePathFromUrl(mediaUrl, 'catalog')
  if (!path) throw new MetaTemplateError('media_not_found')
  const file = await downloadObject('catalog', path)
  const name = path.split('/').pop() ?? 'sample'
  const session = await graph(
    `/${appId}/uploads?file_name=${encodeURIComponent(name)}&file_length=${file.body.length}&file_type=${encodeURIComponent(file.contentType)}`,
    token,
    { method: 'POST' },
  )
  const { graphBase } = await getMetaConfig()
  const res = await fetch(`${graphBase}/${session.id as string}`, {
    method: 'POST',
    headers: { Authorization: `OAuth ${token}`, file_offset: '0', 'Content-Type': file.contentType },
    body: new Uint8Array(file.body),
    signal: AbortSignal.timeout(120_000),
  })
  const out = (await res.json().catch(() => ({}))) as { h?: string; error?: { message?: string } }
  if (!res.ok || !out.h) throw new MetaTemplateError(out.error?.message || 'media_upload_failed')
  return out.h
}

async function payloadFor(draft: TemplateDraft, token: string) {
  const handle = ['image', 'video', 'document'].includes(draft.header.type) && draft.header.mediaUrl ? await uploadHeaderSample(draft.header.mediaUrl, token) : undefined
  return toMetaPayload(draft, handle)
}

const STATUS: Record<string, 'Pending' | 'Approved' | 'Rejected'> = {
  APPROVED: 'Approved',
  PENDING: 'Pending',
  IN_APPEAL: 'Pending',
  REINSTATED: 'Approved',
  REJECTED: 'Rejected',
  PAUSED: 'Rejected',
  DISABLED: 'Rejected',
  FLAGGED: 'Approved',
  PENDING_DELETION: 'Rejected',
}

export function localStatus(metaStatus: string | undefined): 'Pending' | 'Approved' | 'Rejected' {
  return STATUS[(metaStatus ?? '').toUpperCase()] ?? 'Pending'
}

/** Submits a new template. Returns Meta's id and status, plus the variables with their positions. */
export async function submitTemplate(channel: LoadedChannel, draft: TemplateDraft): Promise<{ id: string; status: 'Pending' | 'Approved' | 'Rejected'; category: string | null; variables: TemplateVariable[] }> {
  const { token, wabaId } = channelAuth(channel)
  const { payload, variables } = await payloadFor(draft, token)
  const out = await graph(`/${wabaId}/message_templates`, token, { method: 'POST', body: JSON.stringify(payload) })
  return { id: String(out.id), status: localStatus(out.status as string), category: typeof out.category === 'string' ? out.category : null, variables }
}

/** Edits a submitted template (Meta reviews it again). */
export async function editTemplate(channel: LoadedChannel, metaId: string, draft: TemplateDraft): Promise<{ variables: TemplateVariable[] }> {
  const { token } = channelAuth(channel)
  const { payload, variables } = await payloadFor(draft, token)
  await graph(`/${metaId}`, token, { method: 'POST', body: JSON.stringify({ category: payload.category, components: payload.components }) })
  return { variables }
}

/** Deletes a template (one language when the Meta id is known). */
export async function deleteTemplate(channel: LoadedChannel, name: string, metaId: string | null): Promise<void> {
  const { token, wabaId } = channelAuth(channel)
  const qs = new URLSearchParams({ name, ...(metaId ? { hsm_id: metaId } : {}) })
  await graph(`/${wabaId}/message_templates?${qs}`, token, { method: 'DELETE' })
}

/** Webhook message_template_status_update → our row (any workspace). */
export async function applyTemplateStatusUpdate(update: { metaId: string; event: string; reason?: string | null }): Promise<number> {
  const status = localStatus(update.event)
  const reason = status === 'Rejected' ? (update.reason && update.reason !== 'NONE' ? update.reason : update.event) : null
  // Platform task: Meta identifies the template by its global id.
  const { count } = await prisma.message_templates.updateMany({
    where: { meta_template_id: update.metaId },
    data: { status, rejection_reason: reason, updated_at: new Date() },
  })
  return count
}
