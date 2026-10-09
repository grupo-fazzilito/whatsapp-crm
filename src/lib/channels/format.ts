// Text rules per channel. Pure — shared by the adapters and the agent
// test chat so the preview shows exactly what the customer receives.
import type { ChannelType } from './types'

/** Max characters of one text message per channel. */
export const TEXT_LIMITS: Record<ChannelType, number> = {
  whatsapp: 4096,
  messenger: 2000,
  instagram: 1000,
  tiktok: 1000,
  webchat: 4096,
}

/** Channels that render WhatsApp-style *bold* _italic_ ~strike~ markup. */
export function supportsMarkup(type: ChannelType): boolean {
  return type === 'whatsapp' || type === 'webchat'
}

/** "*Hola* _Ana_ ~x~ ```code```" → "Hola Ana x code" (channels that show text literally). */
export function stripMarkup(text: string): string {
  return text
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/(^|[\s(¡¿"'])\*([^*\n]+?)\*(?=$|[\s).,;:!?"'])/g, '$1$2')
    .replace(/(^|[\s(¡¿"'])_([^_\n]+?)_(?=$|[\s).,;:!?"'])/g, '$1$2')
    .replace(/(^|[\s(¡¿"'])~([^~\n]+?)~(?=$|[\s).,;:!?"'])/g, '$1$2')
}

/** Splits a long text into channel-sized messages, preferring paragraph, line and word breaks. */
export function splitText(text: string, max: number): string[] {
  const out: string[] = []
  let rest = text.trim()
  while (rest.length > max) {
    const window = rest.slice(0, max)
    const cut = Math.max(window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf(' '))
    const at = cut > max * 0.5 ? cut : max
    out.push(rest.slice(0, at).trimEnd())
    rest = rest.slice(at).trimStart()
  }
  if (rest) out.push(rest)
  return out
}

/** Text as a channel will display it: markup handled, split to its limit. */
export function channelText(type: ChannelType, text: string): string[] {
  const t = supportsMarkup(type) ? text : stripMarkup(text)
  return splitText(t, TEXT_LIMITS[type])
}
