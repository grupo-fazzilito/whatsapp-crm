import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { getBooking, patchBooking } from '@/lib/public-api/bookings'

type P = { id: string }

export const GET = apiRoute<P>({ resource: 'bookings', access: 'read' }, async ({ ctx, params }) => ({ data: await getBooking(ctx.workspace.id, params.id) }))

/** PATCH /api/v1/bookings/{id} {status?, notes?} */
export const PATCH = apiRoute<P>({ resource: 'bookings', access: 'write' }, async ({ ctx, params, request }) => ({
  data: await patchBooking(ctx.workspace.id, params.id, await jsonBody(request)),
}))
