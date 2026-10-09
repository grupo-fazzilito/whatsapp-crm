// Agent test chat: how each channel displays the agent's messages. Pure and
// client-safe. Messenger/Instagram reuse the adapter's own message builder
// (metaMessages), so the preview can't drift from what is really sent.
import type { OutboundContent } from '@/lib/channels/types'
import { channelText, stripMarkup } from '@/lib/channels/format'
import { metaMessages } from '@/lib/channels/adapters/meta-messaging'

export type PreviewChannel = 'whatsapp' | 'instagram' | 'messenger' | 'webchat'

export interface PreviewCard {
  imageUrl: string
  title: string
  subtitle?: string
  buttons: string[]
}

export type Bubble =
  | { kind: 'text'; text: string; markup: boolean; quickReplies?: string[] }
  | { kind: 'image'; url: string; caption?: string; markup: boolean }
  | { kind: 'buttons'; text: string; markup: boolean; buttons: string[]; imageUrl?: string }
  | { kind: 'list'; text: string; markup: boolean; buttonLabel: string; rows: { title: string; description?: string }[] }
  | { kind: 'carousel'; text?: string; markup: boolean; cards: PreviewCard[] }

const WA_BUTTON_MAX = 3

function cardBody(c: { title: string; subtitle?: string }) {
  return [`*${c.title}*`, c.subtitle].filter(Boolean).join('\n')
}

function whatsappLike(channel: 'whatsapp' | 'webchat', c: OutboundContent): Bubble[] {
  const limitButtons = channel === 'whatsapp'
  switch (c.type) {
    case 'text':
      return channelText(channel, c.text).map((text) => ({ kind: 'text', text, markup: true }))
    case 'media':
      if (c.mediaType === 'image') return [{ kind: 'image', url: c.url, caption: c.caption, markup: true }]
      return [{ kind: 'text', text: `📎 ${c.caption || c.mediaType}`, markup: true }]
    case 'buttons':
      if (!limitButtons || c.options.length <= WA_BUTTON_MAX) {
        return [{ kind: 'buttons', text: c.text.slice(0, 1024), markup: true, buttons: c.options.map((o) => (limitButtons ? o.title.slice(0, 20) : o.title)) }]
      }
      return [{ kind: 'list', text: c.text, markup: true, buttonLabel: 'Ver opciones', rows: c.options.map((o) => ({ title: o.title.slice(0, 24), description: o.description })) }]
    case 'list':
      return [{ kind: 'list', text: c.text, markup: true, buttonLabel: c.buttonLabel, rows: c.sections.flatMap((s) => s.options.map((o) => ({ title: o.title.slice(0, 24), description: o.description }))) }]
    case 'carousel': {
      const cards = c.cards.slice(0, 10)
      if (channel === 'whatsapp' && cards.length === 1) {
        // A single card goes as an image message with reply buttons.
        const card = cards[0]
        return [{ kind: 'buttons', text: cardBody(card), markup: true, imageUrl: card.imageUrl, buttons: card.buttons.slice(0, WA_BUTTON_MAX).map((b) => b.title.slice(0, 20)) }]
      }
      // WhatsApp carousels need the same number of buttons on every card.
      const count = channel === 'whatsapp' ? Math.min(...cards.map((x) => x.buttons.length), WA_BUTTON_MAX) : 3
      return [
        {
          kind: 'carousel',
          text: c.text,
          markup: true,
          cards: cards.map((card) => ({ imageUrl: card.imageUrl, title: card.title, subtitle: card.subtitle, buttons: card.buttons.slice(0, count).map((b) => b.title.slice(0, 20)) })),
        },
      ]
    }
    case 'location':
      return [{ kind: 'text', text: `📍 ${[c.name, c.address].filter(Boolean).join(' — ') || 'Ubicación'}`, markup: true }]
    case 'template':
      return [{ kind: 'text', text: `[plantilla ${c.templateName}]`, markup: false }]
  }
}

function meta(channel: 'instagram' | 'messenger', c: OutboundContent): Bubble[] {
  const out: Bubble[] = []
  for (const m of metaMessages(channel, c) as Record<string, unknown>[]) {
    if (typeof m.text === 'string') {
      const qr = (m.quick_replies as { title: string }[] | undefined)?.map((q) => q.title)
      out.push({ kind: 'text', text: m.text, markup: false, ...(qr?.length ? { quickReplies: qr } : {}) })
      continue
    }
    const att = m.attachment as { type: string; payload: Record<string, unknown> } | undefined
    if (!att) continue
    if (att.type === 'image') out.push({ kind: 'image', url: String(att.payload.url), markup: false })
    else if (att.type === 'template') {
      const elements = (att.payload.elements as { title: string; subtitle?: string; image_url: string; buttons: { title: string }[] }[]) ?? []
      out.push({
        kind: 'carousel',
        markup: false,
        cards: elements.map((e) => ({ imageUrl: e.image_url, title: e.title, subtitle: e.subtitle, buttons: e.buttons.map((b) => b.title) })),
      })
    } else out.push({ kind: 'text', text: `📎 ${att.type}`, markup: false })
  }
  return out
}

/** Bubbles the customer would see on `channel` for these outbound messages, in order. */
export function renderForChannel(channel: PreviewChannel, contents: OutboundContent[]): Bubble[] {
  return contents.flatMap((c) => (channel === 'instagram' || channel === 'messenger' ? meta(channel, c) : whatsappLike(channel, c)))
}

/** Plain text of a bubble (copy, accessibility). */
export function bubbleText(b: Bubble): string {
  if (b.kind === 'image') return b.caption ? stripMarkup(b.caption) : ''
  if (b.kind === 'carousel') return [b.text, ...b.cards.map((c) => c.title)].filter(Boolean).join('\n')
  return stripMarkup(b.text)
}
