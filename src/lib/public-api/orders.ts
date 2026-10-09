import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { markOrderPaid, updateOrderStatus } from '@/lib/orders/service'
import { createManualOrder } from '@/lib/orders/manual'
import type { Fulfillment, OrderStatus } from '@/lib/orders/texts'
import type { ApiContext } from './auth'
import { ApiError, badRequest, notFound, unprocessable } from './errors'
import { keysetPage } from './keyset'
import { parseIsoParam } from './pagination'
import { serializeOrder } from './serializers'
import { bool, isUuidLike, oneOf, queryEnum, queryUuid, str, uuid } from './validate'

export const ORDER_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'shipped', 'delivered', 'cancelled'] as const
const PAYMENT_STATUSES = ['unpaid', 'awaiting_proof', 'proof_received', 'paid', 'refunded'] as const

// ORDER_SELECT (serializers.ts) as a Prisma select.
const ORDER_FIELDS = {
  id: true,
  number: true,
  status: true,
  payment_status: true,
  fulfillment: true,
  contact_id: true,
  conversation_id: true,
  customer_name: true,
  customer_phone: true,
  address: true,
  address_reference: true,
  notes: true,
  currency: true,
  subtotal: true,
  delivery_fee: true,
  discount: true,
  total: true,
  payment_method_name: true,
  paid_at: true,
  source: true,
  created_at: true,
  updated_at: true,
  order_items: {
    select: { id: true, product_id: true, variant_id: true, name: true, sku: true, quantity: true, unit_price: true, total: true, sort_order: true },
  },
} as const

export async function listOrders(workspaceId: string, url: URL) {
  const where: Record<string, unknown> = { workspace_id: workspaceId }
  const status = queryEnum(url, 'status', ORDER_STATUSES)
  if (status) where.status = status
  const payment = queryEnum(url, 'payment_status', PAYMENT_STATUSES)
  if (payment) where.payment_status = payment
  const contactId = queryUuid(url, 'contact_id')
  if (contactId) where.contact_id = contactId
  const since = parseIsoParam(url.searchParams.get('updated_since'))
  const createdSince = parseIsoParam(url.searchParams.get('created_since'))
  if (since) where.updated_at = { gte: since }
  if (createdSince) where.created_at = { gte: createdSince }
  const db = tenantDb(workspaceId)
  const page = await keysetPage({
    workspaceId,
    table: 'orders',
    column: 'created_at',
    where,
    url,
    findMany: (args) => db.orders.findMany({ ...args, select: ORDER_FIELDS }) as unknown as Promise<(Record<string, unknown> & { id: string })[]>,
  })
  return { data: page.data.map(serializeOrder), next_cursor: page.next_cursor }
}

export async function getOrder(workspaceId: string, id: string) {
  if (!isUuidLike(id)) throw notFound('Order')
  const data = await tenantDb(workspaceId)
    .orders.findFirst({ select: ORDER_FIELDS, where: { id, workspace_id: workspaceId } })
    .catch(() => null)
  if (!data) throw notFound('Order')
  return serializeOrder(data as unknown as Record<string, unknown>)
}

/** The key's creator, or the workspace owner when that user is gone. */
export async function actorUserId(ctx: ApiContext): Promise<string> {
  if (ctx.createdBy) return ctx.createdBy
  const data = await tenantDb(ctx.workspace.id)
    .workspace_members.findFirst({ select: { user_id: true }, where: { workspace_id: ctx.workspace.id, role: 'owner' } })
    .catch(() => null)
  if (!data) throw new Error('workspace has no owner')
  return data.user_id as string
}

const STATUS_ERRORS: Record<string, [number, string]> = {
  not_found: [404, 'Order not found'],
  closed: [409, 'The order is already delivered or cancelled.'],
  invalid_status: [422, 'That status change is not allowed.'],
}

/**
 * PATCH /orders/{id}: { status?, reason?, notify? } and/or
 * { payment_status: 'paid', notify? }. The customer is messaged in the
 * order's conversation unless notify is false.
 */
export async function patchOrder(ctx: ApiContext, id: string, body: Record<string, unknown>) {
  const ws = ctx.workspace.id
  await getOrder(ws, id)
  const status = oneOf(body, 'status', ORDER_STATUSES)
  const payment = oneOf(body, 'payment_status', ['paid'] as const)
  if (!status && !payment) throw badRequest('Send status and/or payment_status ("paid").')
  const notify = bool(body, 'notify')
  const reason = str(body, 'reason', { max: 500 }) ?? null

  if (status) {
    const res = await updateOrderStatus({ workspaceId: ws, orderId: id, status: status as OrderStatus, userId: ctx.createdBy, reason, notify })
    if (!res.ok) {
      const [code, message] = STATUS_ERRORS[res.error] ?? [409, `Status change refused: ${res.error}`]
      throw new ApiError(code, res.error === 'not_found' ? 'not_found' : res.error, message)
    }
  }
  if (payment) {
    const res = await markOrderPaid(ws, id, ctx.createdBy, notify ?? true)
    if (!res.ok) throw new ApiError(409, res.error, `Payment update refused: ${res.error}`)
  }
  return getOrder(ws, id)
}

const CREATE_ERRORS: Record<string, string> = {
  contact_not_found: 'contact_id is not a contact of this workspace.',
  empty: 'items must have at least one product.',
  fulfillment_not_allowed: 'This fulfillment is not enabled for the workspace.',
  address_required: 'address is required for delivery.',
  unavailable: 'A product or variant is not available.',
  price_on_request: 'A product has no price (price on request).',
  foreign_currency: 'A product is priced in another currency than the workspace.',
}

/** POST /orders — manual order from catalog products (prices from the catalog). */
export async function createOrder(ctx: ApiContext, body: Record<string, unknown>) {
  const contactId = uuid(body, 'contact_id', { required: true })!
  const fulfillment = oneOf(body, 'fulfillment', ['pickup', 'delivery', 'dine_in'] as const, { required: true })! as Fulfillment
  const rawItems = body.items
  if (!Array.isArray(rawItems) || !rawItems.length || rawItems.length > 100) throw badRequest('items must be a non-empty array (max 100).', { field: 'items' })
  const items = rawItems.map((it, i) => {
    const o = (it ?? {}) as Record<string, unknown>
    if (!isUuidLike(o.product_id)) throw badRequest(`items[${i}].product_id must be an id.`, { field: 'items' })
    if (o.variant_id !== undefined && o.variant_id !== null && !isUuidLike(o.variant_id)) throw badRequest(`items[${i}].variant_id must be an id.`, { field: 'items' })
    const quantity = Number(o.quantity ?? 1)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) throw badRequest(`items[${i}].quantity must be 1–999.`, { field: 'items' })
    return { product_id: o.product_id as string, variant_id: (o.variant_id as string | null) ?? null, quantity }
  })
  const result = await createManualOrder({
    workspace: ctx.workspace,
    userId: await actorUserId(ctx),
    contactId,
    items,
    fulfillment,
    address: str(body, 'address', { max: 500 }) ?? null,
    addressReference: str(body, 'address_reference', { max: 500 }) ?? null,
    notes: str(body, 'notes', { max: 2000 }) ?? null,
  })
  if (!result.ok) throw unprocessable(result.error, CREATE_ERRORS[result.error] ?? result.error, result.detail ? { detail: result.detail } : undefined)
  return getOrder(ctx.workspace.id, result.order.id)
}
