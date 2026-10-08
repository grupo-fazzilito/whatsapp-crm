// TikTok Business Messaging API (beta, region- and approval-gated).
// Disabled unless TIKTOK_MESSAGING_ENABLED=true. The endpoint and payload
// below follow the Business Messaging API "send message" shape; confirm
// against the docs you receive with API access before enabling.
import { ChannelSendError, type ChannelAdapter, type OutboundContent } from '../types'

const BASE = process.env.TIKTOK_BM_API_BASE ?? 'https://business-api.tiktok.com/open_api/v1.3'

export function tiktokEnabled(): boolean {
  return process.env.TIKTOK_MESSAGING_ENABLED === 'true'
}

function asText(content: OutboundContent): string {
  switch (content.type) {
    case 'text':
      return content.text
    case 'buttons':
      return [content.text, '', ...content.options.map((o, i) => `${i + 1}. ${o.title}`)].join('\n')
    case 'list':
      return [content.text, '', ...content.sections.flatMap((s) => s.options).map((o, i) => `${i + 1}. ${o.title}`)].join('\n')
    case 'media':
      return content.caption ? `${content.caption}\n${content.url}` : content.url
    case 'carousel':
      return [content.text, '', ...content.cards.map((c, i) => `${i + 1}. ${c.title}${c.subtitle ? ` — ${c.subtitle}` : ''}`)].join('\n')
    case 'template':
      throw new ChannelSendError('Templates are only available on WhatsApp', 'unsupported')
  }
}

export const tiktokAdapter: ChannelAdapter = {
  type: 'tiktok',
  capabilities: { templates: false, reactions: false, interactive: false, replyWindowHours: 48, media: false },
  async send(ctx, content) {
    if (!tiktokEnabled()) {
      throw new ChannelSendError('TikTok messaging is not enabled on this platform yet', 'not_configured')
    }
    const token = ctx.channel.secrets.access_token
    if (!token) throw new ChannelSendError('TikTok access token missing', 'not_configured')
    const res = await fetch(`${BASE}/business/message/send/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Access-Token': token },
      body: JSON.stringify({
        business_id: ctx.channel.external_id,
        recipient_type: 'CONVERSATION',
        recipient: ctx.recipient,
        message_type: 'TEXT',
        text: { body: asText(content) },
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || (data.code && data.code !== 0)) {
      throw new ChannelSendError(data?.message ?? `TikTok API error: ${res.status}`, 'provider_error')
    }
    return { externalId: data?.data?.message?.message_id ?? null }
  },
}
