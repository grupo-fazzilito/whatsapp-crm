import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { windowState } from '@/lib/automations/followup-rules'
import { loadChannel } from '@/lib/channels/store'
import type { Workspace } from '@/lib/workspace/types'
import { sendCartSummary, type CommerceCtx } from './chat'
import { cartItems, type Cart } from './service'

// Open carts with items that nobody touched for a while get ONE reminder
// with the cart summary and the "Finalizar pedido" button — only while
// the channel's reply window is still open (no paid template needed).
// Hours come from workspaces.settings.orders.abandoned_cart_hours
// (default 2, 0 = off).

const DEFAULT_HOURS = 2
const BATCH = 50

export function abandonedHours(ws: Pick<Workspace, 'settings'>): number {
  const raw = (ws.settings?.orders as { abandoned_cart_hours?: unknown } | undefined)?.abandoned_cart_hours
  const n = raw === undefined || raw === null ? DEFAULT_HOURS : Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_HOURS
}

export async function remindAbandonedCarts(now = new Date()): Promise<{ reminded: number; skipped: number }> {
  // Platform cron over every workspace. Oldest candidates first;
  // per-workspace hours are checked below.
  const due = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM public.carts
    WHERE status = 'open'
      AND (checkout->>'reminded_at') IS NULL
      AND updated_at < ${new Date(now.getTime() - 30 * 60_000)}::timestamptz
      AND updated_at > ${new Date(now.getTime() - 48 * 3_600_000)}::timestamptz
    ORDER BY updated_at ASC
    LIMIT ${BATCH}`
  const carts = due.length
    ? await prisma.carts.findMany({
        where: { id: { in: due.map((d) => d.id) } },
        orderBy: { updated_at: 'asc' },
        select: {
          id: true,
          workspace_id: true,
          conversation_id: true,
          contact_id: true,
          checkout: true,
          updated_at: true,
          workspaces: true,
          conversations: { select: { channel_id: true, ai_agent_id: true, ai_paused_until: true } },
        },
      })
    : []

  let reminded = 0
  let skipped = 0
  for (const row of carts) {
    const ws = row.workspaces as unknown as Workspace
    const conv = row.conversations as unknown as { channel_id: string | null; ai_agent_id: string | null; ai_paused_until: string | null } | null
    const hours = abandonedHours(ws)
    const idleMs = now.getTime() - new Date(row.updated_at ?? 0).getTime()
    if (!hours || idleMs < hours * 3_600_000 || !row.conversation_id || !conv?.channel_id) {
      skipped++
      continue
    }
    const conversationId = row.conversation_id as string
    const cart = row as unknown as Cart
    if (!(await cartItems(cart.id, ws.id)).length) {
      skipped++
      continue
    }
    const channel = await loadChannel(ws.id, conv.channel_id)
    const db = tenantDb(ws.id)
    const lastIn = await db.messages.findFirst({
      select: { created_at: true },
      where: { conversation_id: conversationId, sender_type: 'customer' },
      orderBy: { created_at: 'desc' },
    })
    const checkout = (row.checkout ?? {}) as Record<string, unknown>
    // Mark first so a slow send can't double-remind on the next tick.
    await db.carts.updateMany({ where: { id: row.id }, data: { checkout: { ...checkout, reminded_at: now.toISOString() } as object } })
    if (!channel || !windowState(channel.type, lastIn?.created_at, now).open) {
      skipped++
      continue
    }
    const ctx: CommerceCtx = {
      workspace: ws,
      channel,
      conversationId,
      contactId: row.contact_id as string,
      aiAgentId: conv.ai_agent_id ?? channel.ai_agent_id,
    }
    await sendCartSummary(ctx, { ...cart, checkout: { ...checkout } }, ws.locale === 'en' ? 'You left these in your cart 👇' : '¿Terminamos tu pedido? Dejaste esto en tu carrito 👇')
    reminded++
  }
  return { reminded, skipped }
}
