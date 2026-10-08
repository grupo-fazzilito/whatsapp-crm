import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { createDeal, listDeals } from '@/lib/public-api/crm'

/** GET /api/v1/deals?pipeline_id&stage_id&status&contact_id&updated_since&limit&cursor */
export const GET = apiRoute({ resource: 'crm', access: 'read' }, ({ ctx, url }) => listDeals(ctx.workspace.id, url))

export const POST = apiRoute(
  { resource: 'crm', access: 'write' },
  async ({ ctx, request }) => ({ data: await createDeal(ctx, await jsonBody(request)) }),
  { status: 201 },
)
