import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import type { TenantDb } from '@/lib/db/tenant'

// Orders for the dashboard (list, board, detail, sidebar badge). Rows keep
// the PostgREST shape the UI used ('…, contact:contacts(name, phone),
// channel:channels(type, name), order_items(count)').

export const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled'] as const
export const PAYMENT_STATUSES = ['unpaid', 'awaiting_proof', 'proof_received', 'paid', 'refunded'] as const
export const ORDER_LIST_LIMIT = 200

const ORDER_SELECT = {
  id: true,
  number: true,
  status: true,
  fulfillment: true,
  customer_name: true,
  customer_phone: true,
  contact_id: true,
  conversation_id: true,
  channel_id: true,
  address: true,
  address_reference: true,
  notes: true,
  currency: true,
  subtotal: true,
  delivery_fee: true,
  discount: true,
  total: true,
  payment_status: true,
  payment_method_id: true,
  payment_method_name: true,
  payment_proof_url: true,
  paid_at: true,
  source: true,
  created_at: true,
  updated_at: true,
  contacts: { select: { name: true, phone: true } },
  channels: { select: { type: true, name: true } },
  _count: { select: { order_items: true } },
} satisfies Prisma.ordersSelect

function orderRow<T extends { contacts: unknown; channels: unknown; _count: { order_items: number } }>({ contacts, channels, _count, ...rest }: T) {
  return { ...rest, contact: contacts, channel: channels, order_items: [{ count: _count.order_items }] }
}

export interface OrderListFilters {
  /** Exact status (list view). */
  status?: string | null
  /** Board view: everything but cancelled. */
  excludeCancelled?: boolean
  paymentStatuses?: string[]
  /** Search box: "#123" / digits → number or phone, else name or phone. */
  q?: string | null
  /** ISO timestamps (inclusive). */
  from?: string | null
  to?: string | null
}

export function orderWhere(f: OrderListFilters): Prisma.ordersWhereInput {
  const and: Prisma.ordersWhereInput[] = []
  if (f.status && (ORDER_STATUSES as readonly string[]).includes(f.status)) and.push({ status: f.status })
  if (f.excludeCancelled) and.push({ status: { not: 'cancelled' } })
  const pay = (f.paymentStatuses ?? []).filter((p) => (PAYMENT_STATUSES as readonly string[]).includes(p))
  if (pay.length) and.push({ payment_status: { in: pay } })
  const s = (f.q ?? '').trim().slice(0, 100)
  if (s) {
    const num = s.replace(/^#/, '')
    if (/^\d+$/.test(num) && num.length < 10) {
      and.push({ OR: [{ number: Number(num) }, { customer_phone: { contains: num, mode: 'insensitive' } }] })
    } else {
      and.push({ OR: [{ customer_name: { contains: s, mode: 'insensitive' } }, { customer_phone: { contains: s, mode: 'insensitive' } }] })
    }
  }
  const date = (v: string | null | undefined) => {
    if (!v) return null
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  const from = date(f.from)
  const to = date(f.to)
  if (from) and.push({ created_at: { gte: from } })
  if (to) and.push({ created_at: { lte: to } })
  return and.length ? { AND: and } : {}
}

/** Newest first, at most ORDER_LIST_LIMIT rows. */
export async function listOrders(db: TenantDb, f: OrderListFilters) {
  const rows = await db.orders.findMany({ select: ORDER_SELECT, where: orderWhere(f), orderBy: { created_at: 'desc' }, take: ORDER_LIST_LIMIT })
  return rows.map(orderRow)
}

/** One order with its items and timeline, or null. */
export async function getOrderDetail(db: TenantDb, orderId: string) {
  const [order, items, events] = await Promise.all([
    db.orders.findFirst({ select: ORDER_SELECT, where: { id: orderId } }),
    db.order_items.findMany({
      select: { id: true, name: true, variant_name: true, sku: true, quantity: true, unit_price: true, total: true, notes: true, sort_order: true },
      where: { order_id: orderId },
      orderBy: { sort_order: 'asc' },
    }),
    db.order_events.findMany({
      select: { id: true, type: true, from_value: true, to_value: true, note: true, user_id: true, created_at: true },
      where: { order_id: orderId },
      orderBy: { created_at: 'asc' },
    }),
  ])
  if (!order) return null
  return { ...orderRow(order), items, events }
}

export async function pendingOrderCount(db: TenantDb): Promise<number> {
  return db.orders.count({ where: { status: 'pending' } })
}
