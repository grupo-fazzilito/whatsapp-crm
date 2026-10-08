import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { createProduct, listProducts } from '@/lib/public-api/products'

/** GET /api/v1/products?q&sku&active&category_id&updated_since&limit&cursor */
export const GET = apiRoute({ resource: 'catalog', access: 'read' }, ({ ctx, url }) => listProducts(ctx.workspace, url))

export const POST = apiRoute(
  { resource: 'catalog', access: 'write' },
  async ({ ctx, request }) => ({ data: await createProduct(ctx.workspace, await jsonBody(request), ctx.createdBy) }),
  { status: 201 },
)
