import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { createBooking, listBookings } from '@/lib/public-api/bookings'

/** GET /api/v1/bookings?date_from&date_to&status&staff_id&service_id&contact_id&updated_since&limit&cursor */
export const GET = apiRoute({ resource: 'bookings', access: 'read' }, ({ ctx, url }) => listBookings(ctx.workspace.id, url))

export const POST = apiRoute(
  { resource: 'bookings', access: 'write' },
  async ({ ctx, request }) => ({ data: await createBooking(ctx.workspace.id, await jsonBody(request)) }),
  { status: 201 },
)
