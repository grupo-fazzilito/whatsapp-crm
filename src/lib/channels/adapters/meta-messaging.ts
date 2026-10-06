// Messenger and Instagram Direct share Meta's Send API: the page access
// token posts to /{page-id}/messages, and the recipient is a page-scoped
// (PSID) or Instagram-scoped (IGSID) id.
import { ChannelSendError, type ChannelAdapter, type ChannelType, type OutboundContent, type SendContext, type SendResult } from '../types'

const GRAPH = 'https://graph.facebook.com/v21.0'
// Messenger quick replies: max 13, title max 20 chars.
const MAX_QUICK_REPLIES = 13

function numberedMenu(text: string, options: { title: string; description?: string }[]): string {
  return [text, '', ...options.map((o, i) => `${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ''}`)].join('\n')
}

function toMessage(content: OutboundContent): Record<string, unknown> {
  switch (content.type) {
    case 'text':
      return { text: content.text }
    case 'media': {
      const type = content.mediaType === 'document' ? 'file' : content.mediaType
      return { attachment: { type, payload: { url: content.url, is_reusable: true } } }
    }
    case 'buttons':
    case 'list': {
      const options = content.type === 'buttons' ? content.options : content.sections.flatMap((s) => s.options)
      if (options.length <= MAX_QUICK_REPLIES) {
        return {
          text: content.text,
          quick_replies: options.map((o) => ({ content_type: 'text', title: o.title.slice(0, 20), payload: o.id })),
        }
      }
      return { text: numberedMenu(content.text, options) }
    }
    case 'template':
      throw new ChannelSendError('Templates are only available on WhatsApp', 'unsupported')
  }
}

function makeAdapter(type: Extract<ChannelType, 'messenger' | 'instagram'>): ChannelAdapter {
  return {
    type,
    capabilities: { templates: false, reactions: type === 'instagram', interactive: true, replyWindowHours: 24, media: true },
    async send(ctx: SendContext, content: OutboundContent): Promise<SendResult> {
      const token = ctx.channel.secrets.access_token
      if (!token) throw new ChannelSendError(`${type} page token missing`, 'not_configured')
      // Instagram accounts are messaged through their linked Facebook page.
      const pageId = (ctx.channel.settings.page_id as string | undefined) ?? ctx.channel.external_id
      const res = await fetch(`${GRAPH}/${pageId}/messages?access_token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: ctx.recipient },
          messaging_type: 'RESPONSE',
          message: toMessage(content),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg: string = data?.error?.message ?? `Meta API error: ${res.status}`
        // 10 / 2018278: outside the allowed messaging window.
        const windowClosed = data?.error?.code === 10 || /outside of allowed window|2018278/i.test(msg)
        throw new ChannelSendError(msg, windowClosed ? 'window_closed' : 'provider_error')
      }
      return { externalId: data.message_id ?? null }
    },
  }
}

export const messengerAdapter = makeAdapter('messenger')
export const instagramAdapter = makeAdapter('instagram')
