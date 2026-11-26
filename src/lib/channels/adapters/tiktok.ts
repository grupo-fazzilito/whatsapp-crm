// TikTok direct messages (Business Messaging API). The business can only
// answer people who wrote first, within TikTok's 48-hour window; the
// recipient is TikTok's conversation id. Text and JPG/PNG images are native;
// buttons, lists and carousels go as a numbered text menu.
import 'server-only'
import { sendTiktokImage, sendTiktokText, TiktokError, TiktokWindowError } from '@/lib/tiktok/api'
import { ChannelSendError, locationText, type ChannelAdapter, type OutboundContent } from '../types'

function asText(content: Exclude<OutboundContent, { type: 'media' }>): string {
  switch (content.type) {
    case 'text':
      return content.text
    case 'buttons':
      return [content.text, '', ...content.options.map((o, i) => `${i + 1}. ${o.title}`)].join('\n')
    case 'list':
      return [content.text, '', ...content.sections.flatMap((s) => s.options).map((o, i) => `${i + 1}. ${o.title}`)].join('\n')
    case 'carousel':
      return [content.text, '', ...content.cards.map((c, i) => `${i + 1}. ${c.title}${c.subtitle ? ` — ${c.subtitle}` : ''}`)].join('\n')
    case 'location':
      return locationText(content)
    case 'template':
      throw new ChannelSendError('Templates are only available on WhatsApp', 'unsupported')
  }
}

/** Our stored files may be relative (/api/...): TikTok needs the bytes, fetched from the public site. */
function absolute(url: string): string {
  if (/^https?:\/\//i.test(url)) return url
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || 'http://localhost:3000'
  return `${site}${url.startsWith('/') ? '' : '/'}${url}`
}

async function fetchImage(url: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const res = await fetch(absolute(url), { cache: 'no-store' }).catch(() => null)
  if (!res?.ok) return null
  const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!/^image\/(jpe?g|png)$/i.test(contentType)) return null
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType }
}

function toSendError(err: unknown): ChannelSendError {
  if (err instanceof ChannelSendError) return err
  if (err instanceof TiktokWindowError) return new ChannelSendError(err.message, 'window_closed')
  if (err instanceof TiktokError && err.needsReconnect) return new ChannelSendError(err.message, 'not_configured')
  return new ChannelSendError(err instanceof Error ? err.message : 'TikTok API error', 'provider_error')
}

export const tiktokAdapter: ChannelAdapter = {
  type: 'tiktok',
  capabilities: { templates: false, reactions: false, interactive: false, replyWindowHours: 48, media: true },
  async send(ctx, content) {
    try {
      if (content.type !== 'media') {
        return { externalId: await sendTiktokText(ctx.channel, ctx.recipient, asText(content)) }
      }
      const caption = content.caption?.trim() ?? ''
      // Only JPG/PNG images are native; anything else goes as a link.
      const image = content.mediaType === 'image' ? await fetchImage(content.url) : null
      if (!image || image.bytes.byteLength > 3 * 1024 * 1024) {
        return { externalId: await sendTiktokText(ctx.channel, ctx.recipient, [caption, absolute(content.url)].filter(Boolean).join('\n')) }
      }
      const imageId = await sendTiktokImage(ctx.channel, ctx.recipient, image)
      // TikTok doesn't take text and image in one message: the caption follows.
      if (caption) await sendTiktokText(ctx.channel, ctx.recipient, caption)
      return { externalId: imageId }
    } catch (err) {
      throw toSendError(err)
    }
  },
}
