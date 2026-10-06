import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendReactionMessage,
  sendTemplateMessage,
  sendTextMessage,
} from '@/lib/whatsapp/meta-api'
import { isRecipientNotAllowedError, phoneVariants, sanitizePhoneForMeta } from '@/lib/whatsapp/phone-utils'
import { ChannelSendError, type ChannelAdapter, type OutboundContent, type SendContext, type SendResult } from '../types'

const GRAPH = 'https://graph.facebook.com/v21.0'

function credentials(ctx: SendContext) {
  const token = ctx.channel.secrets.access_token
  if (!token) throw new ChannelSendError('WhatsApp access token missing', 'not_configured')
  return { phoneNumberId: ctx.channel.external_id, accessToken: token }
}

async function sendMedia(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  c: Extract<OutboundContent, { type: 'media' }>,
  contextMessageId?: string,
): Promise<string> {
  const media: Record<string, unknown> = { link: c.url }
  if (c.caption && c.mediaType !== 'audio') media.caption = c.caption
  if (c.filename && c.mediaType === 'document') media.filename = c.filename
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: c.mediaType,
      [c.mediaType]: media,
      ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message ?? `Meta API error: ${res.status}`)
  return data.messages[0].id
}

async function sendOnce(ctx: SendContext, to: string, content: OutboundContent): Promise<string> {
  const { phoneNumberId, accessToken } = credentials(ctx)
  const contextMessageId = ctx.replyToExternalId ?? undefined
  switch (content.type) {
    case 'text':
      return (await sendTextMessage({ phoneNumberId, accessToken, to, text: content.text, contextMessageId })).messageId
    case 'template':
      return (
        await sendTemplateMessage({
          phoneNumberId,
          accessToken,
          to,
          templateName: content.templateName,
          language: content.language,
          params: content.params,
          components: content.components,
          contextMessageId,
        })
      ).messageId
    case 'buttons':
      return (
        await sendInteractiveButtons({
          phoneNumberId,
          accessToken,
          to,
          bodyText: content.text,
          headerText: content.header,
          footerText: content.footer,
          buttons: content.options.map((o) => ({ id: o.id, title: o.title })),
          contextMessageId,
        })
      ).messageId
    case 'list':
      return (
        await sendInteractiveList({
          phoneNumberId,
          accessToken,
          to,
          bodyText: content.text,
          buttonLabel: content.buttonLabel,
          headerText: content.header,
          footerText: content.footer,
          sections: content.sections.map((s) => ({
            title: s.title,
            rows: s.options.map((o) => ({ id: o.id, title: o.title, description: o.description })),
          })),
          contextMessageId,
        })
      ).messageId
    case 'media':
      return sendMedia(phoneNumberId, accessToken, to, content, contextMessageId)
  }
}

export const whatsappAdapter: ChannelAdapter = {
  type: 'whatsapp',
  capabilities: { templates: true, reactions: true, interactive: true, replyWindowHours: 24, media: true },

  // Meta sometimes knows a number with/without a trunk 0 (sandbox lists
  // especially); retry the known variants before giving up.
  async send(ctx, content): Promise<SendResult> {
    const variants = phoneVariants(sanitizePhoneForMeta(ctx.recipient))
    if (variants.length === 0) throw new ChannelSendError('Contact has no phone number', 'unsupported')
    let lastError: unknown
    for (const to of variants) {
      try {
        return { externalId: await sendOnce(ctx, to, content), recipient: to }
      } catch (err) {
        lastError = err
        const msg = err instanceof Error ? err.message : String(err)
        if (!isRecipientNotAllowedError(msg)) break
      }
    }
    const msg = lastError instanceof Error ? lastError.message : String(lastError)
    throw new ChannelSendError(msg, /24 hour|re-engagement|131047/i.test(msg) ? 'window_closed' : 'provider_error')
  },

  async sendReaction(ctx, targetExternalId, emoji) {
    const { phoneNumberId, accessToken } = credentials(ctx)
    await sendReactionMessage({
      phoneNumberId,
      accessToken,
      to: sanitizePhoneForMeta(ctx.recipient),
      targetMessageId: targetExternalId,
      emoji,
    })
  },
}
