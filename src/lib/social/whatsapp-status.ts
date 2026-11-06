import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { sendMessage } from '@/lib/messaging/send'
import { findOrCreateContactByPhone, findOrCreateConversationOnChannel } from '@/lib/messaging/conversations'
import { defaultChannel, loadChannel } from '@/lib/channels/store'
import { windowState } from '@/lib/automations/followup-rules'
import { saveTemplate } from '@/lib/templates/server'
import type { TemplateDraft } from '@/lib/templates/model'
import { siteUrl } from '@/lib/real-estate/listing/url'
import type { PostMedia, TargetResult } from './model'

// "Estado de WhatsApp": Meta has no API to post statuses, so at the post's
// time Whasalia sends the photo/video and the text to the business's own
// phone(s), from its WhatsApp number, ready to forward to the status. The
// message links to a page (/estado/<token>) with "Share" (opens WhatsApp
// with the file on the phone) and downloads.
// Outside the 24 h window only a template can go out: "Estado listo para
// publicar" (left as a draft; the business sends it to Meta from Publicaciones).

type Lang = 'es' | 'en'

export const STATUS_TEMPLATE_NAMES = { es: 'estado_listo_para_publicar', en: 'status_ready_to_post' } as const

export const statusPagePath = (token: string) => `/estado/${encodeURIComponent(token)}`
export const statusPageUrl = (token: string) => `${siteUrl()}${statusPagePath(token)}`

export function statusTemplateDraft(lang: Lang): TemplateDraft {
  const es = lang === 'es'
  return {
    name: STATUS_TEMPLATE_NAMES[lang],
    category: 'Utility',
    language: lang,
    header: { type: 'none' },
    body: es
      ? 'Hola, tu publicación de {{nombre_negocio}} para el estado de WhatsApp está lista. Toca el botón para verla y compartirla en tu estado.'
      : 'Hi, your {{nombre_negocio}} post for your WhatsApp status is ready. Tap the button to see it and share it to your status.',
    footer: '',
    buttons: [{ type: 'url', text: es ? 'Ver publicación' : 'See post', value: `${siteUrl()}/estado/{{1}}`, example: 'a1b2c3d4e5f6g7h8' }],
    variables: [{ key: 'nombre_negocio', label: es ? 'Negocio' : 'Business', example: es ? 'Tienda Demo' : 'Demo Store', source: 'workspace.name' }],
  }
}

export interface StatusTemplate {
  id: string
  name: string
  status: string
  rejection_reason: string | null
  language: string
}

export async function statusTemplate(workspaceId: string, lang: Lang): Promise<StatusTemplate | null> {
  const row = await tenantDb(workspaceId)
    .message_templates.findFirst({ where: { name: STATUS_TEMPLATE_NAMES[lang], language: lang }, select: { id: true, name: true, status: true, rejection_reason: true, language: true } })
    .catch(() => null)
  return row ? { id: row.id, name: row.name, status: row.status ?? 'Draft', rejection_reason: row.rejection_reason, language: row.language ?? lang } : null
}

/** Leaves the template as a draft when the business doesn't have it (nothing goes to Meta). */
export async function ensureStatusTemplate(workspaceId: string, userId: string): Promise<void> {
  const ws = await prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { locale: true } }).catch(() => null)
  if (!ws) return
  const lang: Lang = ws.locale === 'en' ? 'en' : 'es'
  if (await statusTemplate(workspaceId, lang)) return
  try {
    const out = await saveTemplate({ db: tenantDb(workspaceId), workspaceId, userId, draft: statusTemplateDraft(lang), submit: false })
    if (!out.ok && out.status !== 409) console.warn(`[social] status template draft not created for ${workspaceId}:`, JSON.stringify(out.body))
  } catch (err) {
    console.error(`[social] status template draft failed for ${workspaceId}:`, err instanceof Error ? err.message : err)
  }
}

export interface StatusSendInput {
  workspace: { id: string; name: string; locale: string }
  phones: string[]
  channelId: string | null
  media: PostMedia[]
  caption: string
  shareToken: string
}

/** Sends the post to each phone. 'sent' when it reached at least one. */
export async function sendStatusPost(input: StatusSendInput): Promise<TargetResult> {
  const ws = input.workspace
  const lang: Lang = ws.locale === 'en' ? 'en' : 'es'
  const at = new Date().toISOString()
  if (!input.phones.length) return { status: 'failed', error: 'no_status_phones', at }
  const channel = (input.channelId ? await loadChannel(ws.id, input.channelId) : null) ?? (await defaultChannel(ws.id, 'whatsapp'))
  if (!channel || channel.type !== 'whatsapp') return { status: 'failed', error: 'no_whatsapp', at }
  const db = tenantDb(ws.id)
  const link = statusPageUrl(input.shareToken)
  let template: StatusTemplate | null | undefined
  const errors: string[] = []
  let sent = 0

  for (const phone of input.phones) {
    const contactId = await findOrCreateContactByPhone(ws.id, phone, null)
    const conversationId = contactId ? await findOrCreateConversationOnChannel(channel, contactId) : null
    if (!conversationId) {
      errors.push('no_conversation')
      continue
    }
    const conv = await db.conversations.findFirst({ where: { id: conversationId }, select: { last_customer_message_at: true } }).catch(() => null)
    const metadata = { source: 'social_status' }
    if (windowState('whatsapp', (conv?.last_customer_message_at as string | null) ?? null).open) {
      let failed = false
      for (const [i, m] of input.media.entries()) {
        const r = await sendMessage({
          workspaceId: ws.id,
          conversationId,
          content: { type: 'media', mediaType: m.type, url: m.url, ...(i === 0 && input.caption ? { caption: input.caption.slice(0, 1024) } : {}) },
          sender: { type: 'bot' },
          metadata,
        })
        if (r.status === 'failed') failed = true
      }
      const note =
        lang === 'es'
          ? `📲 Listo para tu estado de WhatsApp. Reenvíalo o ábrelo aquí para compartirlo: ${link}`
          : `📲 Ready for your WhatsApp status. Forward it, or open it here to share it: ${link}`
      const r = await sendMessage({ workspaceId: ws.id, conversationId, content: { type: 'text', text: note }, sender: { type: 'bot' }, metadata })
      if (failed || r.status === 'failed') errors.push('send_failed')
      else sent++
      continue
    }
    if (template === undefined) template = await statusTemplate(ws.id, lang)
    if (!template) {
      errors.push('template_missing')
      continue
    }
    if (template.status !== 'Approved') {
      errors.push(template.status === 'Rejected' ? 'template_rejected' : 'template_pending')
      continue
    }
    const text =
      lang === 'es'
        ? `Hola, tu publicación de ${ws.name} para el estado de WhatsApp está lista. Toca el botón para verla y compartirla en tu estado.`
        : `Hi, your ${ws.name} post for your WhatsApp status is ready. Tap the button to see it and share it to your status.`
    const r = await sendMessage({
      workspaceId: ws.id,
      conversationId,
      content: {
        type: 'template',
        templateName: template.name,
        language: template.language,
        components: [
          { type: 'body', parameters: [{ type: 'text', text: ws.name }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: input.shareToken }] },
        ],
      },
      sender: { type: 'bot' },
      metadata: { ...metadata, template: template.name },
    })
    if (r.messageId) await db.messages.updateMany({ where: { id: r.messageId }, data: { content_text: text } }).catch(() => undefined)
    if (r.status === 'failed') errors.push('send_failed')
    else sent++
  }
  return sent ? { status: 'sent', error: errors[0] ?? null, url: link, at } : { status: 'failed', error: errors[0] ?? 'send_failed', at }
}
