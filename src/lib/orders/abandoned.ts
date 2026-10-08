import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
  const db = supabaseAdmin()
  // Oldest candidates first; per-workspace hours are checked below.
  const { data: carts } = await db
    .from('carts')
    .select('id, workspace_id, conversation_id, contact_id, checkout, updated_at, workspace:workspaces(*), conversation:conversations(channel_id, ai_agent_id, ai_paused_until)')
    .eq('status', 'open')
    .is('checkout->>reminded_at', null)
    .lt('updated_at', new Date(now.getTime() - 30 * 60_000).toISOString())
    .gt('updated_at', new Date(now.getTime() - 48 * 3_600_000).toISOString())
    .order('updated_at', { ascending: true })
    .limit(BATCH)

  let reminded = 0
  let skipped = 0
  for (const row of carts ?? []) {
    const ws = row.workspace as unknown as Workspace
    const conv = row.conversation as unknown as { channel_id: string | null; ai_agent_id: string | null; ai_paused_until: string | null } | null
    const hours = abandonedHours(ws)
    const idleMs = now.getTime() - new Date(row.updated_at).getTime()
    if (!hours || idleMs < hours * 3_600_000 || !row.conversation_id || !conv?.channel_id) {
      skipped++
      continue
    }
    const cart = row as unknown as Cart
    if (!(await cartItems(cart.id)).length) {
      skipped++
      continue
    }
    const channel = await loadChannel(ws.id, conv.channel_id)
    const { data: lastIn } = await db
      .from('messages')
      .select('created_at')
      .eq('conversation_id', row.conversation_id)
      .eq('sender_type', 'customer')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    // Mark first so a slow send can't double-remind on the next tick.
    await db.from('carts').update({ checkout: { ...(row.checkout ?? {}), reminded_at: now.toISOString() } }).eq('id', row.id)
    if (!channel || !windowState(channel.type, lastIn?.created_at, now).open) {
      skipped++
      continue
    }
    const ctx: CommerceCtx = {
      workspace: ws,
      channel,
      conversationId: row.conversation_id,
      contactId: row.contact_id,
      aiAgentId: conv.ai_agent_id ?? channel.ai_agent_id,
    }
    await sendCartSummary(ctx, { ...cart, checkout: { ...(row.checkout ?? {}) } }, ws.locale === 'en' ? 'You left these in your cart 👇' : '¿Terminamos tu pedido? Dejaste esto en tu carrito 👇')
    reminded++
  }
  return { reminded, skipped }
}
