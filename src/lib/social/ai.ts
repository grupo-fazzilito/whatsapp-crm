import 'server-only'
import { completeJson, parseJsonLoose } from '@/lib/ai/llm'
import { canSpend, spend } from '@/lib/billing/credits'
import { formatMoney, moneyLocale } from '@/lib/workspace/countries'
import { MAX_CAPTION, type PostFormat, type Target } from './model'

// Captions written by the AI (1 "social_caption" token each, like the rest of the AI).

export class CaptionError extends Error {
  constructor(readonly code: 'no_credits' | 'failed') {
    super(code)
  }
}

export interface CaptionInput {
  workspace: { id: string; name: string; description: string | null; locale: string; currency: string; country: string | null }
  product?: { name: string; description: string | null; price: number | null; compare_at_price: number | null } | null
  /** What the business asked for ("promo 2x1 this weekend"…). */
  idea?: string | null
  link?: string | null
  format: PostFormat
  targets: Target[]
  instructions?: string | null
  origin?: 'manual' | 'new_product' | 'restock' | 'calendar'
}

const SCHEMA = {
  type: 'object',
  properties: { caption: { type: 'string' } },
  required: ['caption'],
}

export function captionPrompt(i: CaptionInput): { system: string; user: string } {
  const es = i.workspace.locale !== 'en'
  const money = (n: number) => formatMoney(n, i.workspace.currency, moneyLocale({ locale: es ? 'es' : 'en', country: i.workspace.country }))
  const lines = [
    `Business: ${i.workspace.name}`,
    i.workspace.description ? `About the business: ${i.workspace.description.slice(0, 500)}` : '',
    i.product ? `Product: ${i.product.name}` : '',
    i.product?.description ? `Product details: ${i.product.description.slice(0, 800)}` : '',
    i.product?.price != null
      ? i.product.compare_at_price && i.product.compare_at_price > i.product.price
        ? `Price: ${money(i.product.price)} (before ${money(i.product.compare_at_price)})`
        : `Price: ${money(i.product.price)}`
      : '',
    i.origin === 'new_product' ? 'Occasion: this product is new in the store.' : '',
    i.origin === 'restock' ? 'Occasion: this product is back in stock.' : '',
    i.idea ? `What the business wants to say: ${i.idea.slice(0, 600)}` : '',
    i.link ? `Store link: ${i.link}` : '',
    `Format: ${i.format === 'story' ? 'story (very short text, 1 line)' : i.format === 'reel' ? 'reel (short and catchy)' : 'feed post'}`,
    `Published on: ${i.targets.map((t) => (t === 'whatsapp_status' ? 'WhatsApp status' : t)).join(', ')}`,
    i.instructions ? `Business instructions for captions: ${i.instructions.slice(0, 500)}` : '',
  ].filter(Boolean)
  const system = [
    `You write social media captions for a small business. Language: ${es ? 'Spanish (neutral Latin American)' : 'English'}.`,
    'Rules:',
    '- Warm, clear and selling, without exaggerating. Never invent prices, discounts, sizes or dates that are not given.',
    '- 2 to 5 short lines for a feed post or reel; one short line for a story. A few relevant emojis are fine.',
    '- End with a clear call to action (order by WhatsApp, visit the store…).',
    '- 3 to 6 relevant hashtags at the end of feed posts and reels (none in stories).',
    i.link && i.targets.includes('instagram')
      ? `- Links are not clickable on Instagram: say "${es ? 'link en la bio' : 'link in bio'}" instead of writing the URL (Facebook gets the link added automatically).`
      : '- Do not write URLs (the link is added automatically).',
    `- At most ${MAX_CAPTION} characters.`,
    'Answer only JSON: {"caption": "..."}',
  ].join('\n')
  return { system, user: lines.join('\n') }
}

export async function writeCaption(i: CaptionInput): Promise<string> {
  if (!(await canSpend(i.workspace.id, 'social_caption'))) throw new CaptionError('no_credits')
  const p = captionPrompt(i)
  const raw = await completeJson({
    system: p.system,
    turns: [{ role: 'user', content: p.user }],
    schema: SCHEMA,
    temperature: 0.8,
    timeoutMs: 30_000,
    meter: { workspaceId: i.workspace.id, purpose: 'social_caption' },
  })
  const caption = parseJsonLoose<{ caption?: unknown }>(raw)?.caption
  if (typeof caption !== 'string' || !caption.trim()) throw new CaptionError('failed')
  await spend(i.workspace.id, 'social_caption')
  return caption.trim().slice(0, MAX_CAPTION)
}

/** Without AI (no tokens or the AI failed): a plain caption for automatic posts. */
export function fallbackCaption(i: CaptionInput): string {
  const es = i.workspace.locale !== 'en'
  const name = i.product?.name ?? i.workspace.name
  const money = (n: number) => formatMoney(n, i.workspace.currency, moneyLocale({ locale: es ? 'es' : 'en', country: i.workspace.country }))
  const price = i.product?.price != null ? ` · ${money(i.product.price)}` : ''
  const head =
    i.origin === 'new_product'
      ? es ? `✨ Nuevo: ${name}${price}` : `✨ New: ${name}${price}`
      : i.origin === 'restock'
        ? es ? `🔥 Volvió: ${name}${price}` : `🔥 Back in stock: ${name}${price}`
        : `${name}${price}`
  const cta = es ? 'Pídelo por WhatsApp o en nuestra tienda.' : 'Order it on WhatsApp or in our store.'
  return i.format === 'story' ? head : `${head}\n\n${cta}`
}
