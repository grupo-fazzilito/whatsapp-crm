import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { createOrder, listOrders } from '@/lib/public-api/orders'

/** GET /api/v1/orders?status&payment_status&contact_id&created_since&updated_since&limit&cursor */
export const GET = apiRoute({ resource: 'orders', access: 'read' }, ({ ctx, url }) => listOrders(ctx.workspace.id, url))

/** POST /api/v1/orders {contact_id, fulfillment, items: [{product_id, variant_id?, quantity}], address?, notes?} */
export const POST = apiRoute(
  { resource: 'orders', access: 'write' },
  async ({ ctx, request }) => ({ data: await createOrder(ctx, await jsonBody(request)) }),
  { status: 201 },
)
