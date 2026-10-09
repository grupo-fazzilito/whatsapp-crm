import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { buildProductCards, carouselIntro, ordersEnabled, productAction } from '@/lib/orders/chat'
import { formatProductPrice } from '@/lib/catalog/currency'
import type { OutboundContent } from '@/lib/channels'
import type { Workspace } from '@/lib/workspace/types'

/**
 * What the agent would send for one answer, in order — the same sequence as
 * runAgent step 8 (text, then product carousel or photo cards) — without
 * sending or storing anything. Rendered per channel by the test chat.
 */
export async function previewOutbound(input: {
  workspace: Workspace
  skills: string[]
  reply: string
  showProductIds: string[]
}): Promise<OutboundContent[]> {
  const out: OutboundContent[] = []
  if (input.reply.trim()) out.push({ type: 'text', text: input.reply })
  const ids = input.showProductIds.slice(0, 10)
  if (!ids.length) return out

  const sells = input.skills.includes('orders') && ordersEnabled(input.workspace)
  if (sells || productAction(input.workspace) === 'book') {
    const { cards } = await buildProductCards(input.workspace, ids)
    if (cards.length) {
      out.push({ type: 'carousel', text: carouselIntro(input.workspace), cards })
      return out
    }
  }
  // Plain photo cards (first 3 with a photo), like sendProductCards.
  const products = await tenantDb(input.workspace.id).products.findMany({
    select: { id: true, name: true, price: true, currency: true, images: true },
    where: { id: { in: ids.slice(0, 3) }, is_active: true },
  })
  for (const p of products) {
    if (!p.images?.[0]) continue
    const price = p.price === null ? '' : ` — ${formatProductPrice(Number(p.price), p, input.workspace)}`
    out.push({ type: 'media', mediaType: 'image', url: p.images[0], caption: `*${p.name}*${price}` })
  }
  return out
}
