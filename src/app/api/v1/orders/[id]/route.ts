import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { getOrder, patchOrder } from '@/lib/public-api/orders'

type P = { id: string }

export const GET = apiRoute<P>({ resource: 'orders', access: 'read' }, async ({ ctx, params }) => ({ data: await getOrder(ctx.workspace.id, params.id) }))

/** PATCH /api/v1/orders/{id} {status?, reason?, payment_status?: 'paid', notify?} */
export const PATCH = apiRoute<P>({ resource: 'orders', access: 'write' }, async ({ ctx, params, request }) => ({
  data: await patchOrder(ctx, params.id, await jsonBody(request)),
}))
