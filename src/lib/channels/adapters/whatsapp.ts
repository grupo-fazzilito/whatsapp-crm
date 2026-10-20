import {
  sendInteractiveButtons,
  sendInteractiveList,
  sendReactionMessage,
  sendTemplateMessage,
  sendTextMessage,
} from '@/lib/whatsapp/meta-api'
import { isBsuid, isRecipientNotAllowedError, phoneVariants, sanitizePhoneForMeta, waAddressee } from '@/lib/whatsapp/phone-utils'
import { ChannelSendError, type CarouselCard, type ChannelAdapter, type OutboundContent, type SendContext, type SendResult } from '../types'

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
      ...waAddressee(to),
      type: c.mediaType,
      [c.mediaType]: media,
      ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message ?? `Meta API error: ${res.status}`)
  return data.messages[0].id
}

/** Payloads below are built with `to`; a BSUID goes in `recipient` instead. */
function addressed({ to, ...rest }: Record<string, unknown>): Record<string, unknown> {
  return typeof to === 'string' ? { ...waAddressee(to), ...rest } : rest
}

async function postMessage(phoneNumberId: string, accessToken: string, payload: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${GRAPH}/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...addressed(payload) }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error?.message ?? `Meta API error: ${res.status}`)
  return data.messages[0].id
}

const quickReplies = (buttons: { id: string; title: string }[]) =>
  buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) } }))

/** One product card: image header + body + reply buttons. */
function cardAsButtons(to: string, card: CarouselCard, contextMessageId?: string) {
  return {
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      header: { type: 'image', image: { link: card.imageUrl } },
      body: { text: [`*${card.title}*`, card.subtitle].filter(Boolean).join('\n').slice(0, 1024) },
      action: { buttons: quickReplies(card.buttons) },
    },
    ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
  }
}

/**
 * Interactive media carousel (2–10 cards, same buttons on every card).
 * If Meta rejects it (older accounts/regions), fall back to one image +
 * buttons message per card so the customer still sees the products.
 */
async function sendCarousel(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  c: Extract<OutboundContent, { type: 'carousel' }>,
  contextMessageId?: string,
): Promise<string> {
  const cards = c.cards.slice(0, 10)
  if (cards.length === 1) return postMessage(phoneNumberId, accessToken, cardAsButtons(to, cards[0], contextMessageId))
  const buttonCount = Math.min(...cards.map((x) => x.buttons.length), 3)
  try {
    return await postMessage(phoneNumberId, accessToken, {
      to,
      type: 'interactive',
      interactive: {
        type: 'carousel',
        body: { text: c.text.slice(0, 1024) },
        action: {
          cards: cards.map((card, i) => ({
            card_index: i,
            header: { type: 'image', image: { link: card.imageUrl } },
            body: { text: [`*${card.title}*`, card.subtitle].filter(Boolean).join('\n').slice(0, 160) },
            action: {
              buttons: card.buttons.slice(0, buttonCount).map((b) => ({
                type: 'quick_reply',
                quick_reply: { id: b.id.slice(0, 256), title: b.title.slice(0, 20) },
              })),
            },
          })),
        },
      },
      ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
    })
  } catch (err) {
    console.warn('[whatsapp] carousel rejected, sending cards one by one:', err instanceof Error ? err.message : err)
    await postMessage(phoneNumberId, accessToken, { to, type: 'text', text: { body: c.text } })
    let first = ''
    for (const card of cards) {
      const id = await postMessage(phoneNumberId, accessToken, cardAsButtons(to, card))
      first ||= id
    }
    return first
  }
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
    case 'carousel':
      return sendCarousel(phoneNumberId, accessToken, to, content, contextMessageId)
    case 'location':
      return postMessage(phoneNumberId, accessToken, {
        to,
        type: 'location',
        location: {
          latitude: content.latitude,
          longitude: content.longitude,
          ...(content.name ? { name: content.name.slice(0, 1000) } : {}),
          ...(content.address ? { address: content.address.slice(0, 1000) } : {}),
        },
        ...(contextMessageId ? { context: { message_id: contextMessageId } } : {}),
      })
  }
}

export const whatsappAdapter: ChannelAdapter = {
  type: 'whatsapp',
  capabilities: { templates: true, reactions: true, interactive: true, replyWindowHours: 24, media: true },

  // Meta sometimes knows a number with/without a trunk 0 (sandbox lists
  // especially); retry the known variants before giving up.
  async send(ctx, content): Promise<SendResult> {
    // Customer known only by their BSUID (username, phone not shared).
    if (isBsuid(ctx.recipient)) {
      try {
        return { externalId: await sendOnce(ctx, ctx.recipient, content), recipient: ctx.recipient }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        throw new ChannelSendError(msg, /24 hour|re-engagement|131047/i.test(msg) ? 'window_closed' : 'provider_error')
      }
    }
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
      to: isBsuid(ctx.recipient) ? ctx.recipient : sanitizePhoneForMeta(ctx.recipient),
      targetMessageId: targetExternalId,
      emoji,
    })
  },
}
