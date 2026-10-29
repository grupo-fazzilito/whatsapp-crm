// Messenger and Instagram Direct share Meta's Send API: the page access
// token posts to /{page-id}/messages, and the recipient is a page-scoped
// (PSID) or Instagram-scoped (IGSID) id.
import { ChannelSendError, locationText, type ChannelAdapter, type ChannelType, type OutboundContent, type SendContext, type SendResult } from '../types'
import { channelText, stripMarkup } from '../format'

const GRAPH = 'https://graph.facebook.com/v21.0'
// Messenger quick replies: max 13, title max 20 chars.
const MAX_QUICK_REPLIES = 13

function numberedMenu(text: string, options: { title: string; description?: string }[]): string {
  return [text, '', ...options.map((o, i) => `${i + 1}. ${o.title}${o.description ? ` — ${o.description}` : ''}`)].join('\n')
}

/**
 * Messages to post, in order. Messenger and Instagram show text literally
 * (no *bold*), cap text length, and drop captions and carousel intros —
 * so captions and intros go as their own text message.
 */
export function metaMessages(type: Extract<ChannelType, 'messenger' | 'instagram'>, content: OutboundContent): Record<string, unknown>[] {
  const texts = (t: string) => channelText(type, t).map((text) => ({ text }))
  switch (content.type) {
    case 'text':
      return texts(content.text)
    case 'media': {
      const kind = content.mediaType === 'document' ? 'file' : content.mediaType
      const attachment = { attachment: { type: kind, payload: { url: content.url, is_reusable: true } } }
      return content.caption?.trim() ? [attachment, ...texts(content.caption)] : [attachment]
    }
    case 'buttons':
    case 'list': {
      const options = content.type === 'buttons' ? content.options : content.sections.flatMap((s) => s.options)
      const text = stripMarkup(content.text)
      if (options.length <= MAX_QUICK_REPLIES) {
        return [{ text, quick_replies: options.map((o) => ({ content_type: 'text', title: o.title.slice(0, 20), payload: o.id })) }]
      }
      return texts(numberedMenu(text, options))
    }
    case 'carousel':
      // Intro text, then a generic template: up to 10 cards with image,
      // title, subtitle and up to 3 postback buttons.
      return [
        ...(content.text?.trim() ? texts(content.text) : []),
        {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'generic',
              elements: content.cards.slice(0, 10).map((c) => ({
                title: stripMarkup(c.title).slice(0, 80),
                ...(c.subtitle ? { subtitle: stripMarkup(c.subtitle).slice(0, 80) } : {}),
                image_url: c.imageUrl,
                buttons: c.buttons.slice(0, 3).map((b) => ({ type: 'postback', title: b.title.slice(0, 20), payload: b.id })),
              })),
            },
          },
        },
      ]
    case 'location':
      return texts(locationText(content))
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
      let first: string | null = null
      for (const message of metaMessages(type, content)) {
        const res = await fetch(`${GRAPH}/${pageId}/messages?access_token=${encodeURIComponent(token)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ recipient: { id: ctx.recipient }, messaging_type: 'RESPONSE', message }),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          const msg: string = data?.error?.message ?? `Meta API error: ${res.status}`
          // 10 / 2018278: outside the allowed messaging window.
          const windowClosed = data?.error?.code === 10 || /outside of allowed window|2018278/i.test(msg)
          // A follow-up part failing (caption, intro) must not hide that the main one went out.
          if (first) {
            console.warn(`[${type}] extra message part failed:`, msg)
            break
          }
          throw new ChannelSendError(msg, windowClosed ? 'window_closed' : 'provider_error')
        }
        first ??= data.message_id ?? null
      }
      return { externalId: first }
    },
  }
}

export const messengerAdapter = makeAdapter('messenger')
export const instagramAdapter = makeAdapter('instagram')

/**
 * Who a PSID / IGSID is: Meta's webhooks carry only the id. Uses the User
 * Profile API with the page token; null when Meta doesn't share it (missing
 * permission, privacy settings), so the caller keeps its fallback name.
 */
export async function fetchMetaProfile(
  type: Extract<ChannelType, 'messenger' | 'instagram'>,
  token: string,
  userId: string,
): Promise<{ name: string | null; handle: string | null } | null> {
  const fields = type === 'messenger' ? 'first_name,last_name' : 'name,username'
  try {
    const res = await fetch(`${GRAPH}/${encodeURIComponent(userId)}?fields=${fields}&access_token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(5000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      console.warn(`[${type}] profile lookup failed:`, data?.error?.message ?? res.status)
      return null
    }
    const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
    if (type === 'messenger') {
      const name = [str(data.first_name), str(data.last_name)].filter(Boolean).join(' ') || null
      return name ? { name, handle: null } : null
    }
    const name = str(data.name)
    const handle = str(data.username)
    return name || handle ? { name, handle } : null
  } catch (err) {
    console.warn(`[${type}] profile lookup failed:`, err instanceof Error ? err.message : err)
    return null
  }
}
