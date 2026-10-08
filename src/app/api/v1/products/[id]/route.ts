import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { getProduct, updateProduct } from '@/lib/public-api/products'

type P = { id: string }

export const GET = apiRoute<P>({ resource: 'catalog', access: 'read' }, async ({ ctx, params }) => ({ data: await getProduct(ctx.workspace, params.id) }))

export const PATCH = apiRoute<P>({ resource: 'catalog', access: 'write' }, async ({ ctx, params, request }) => ({
  data: await updateProduct(ctx.workspace, params.id, await jsonBody(request)),
}))
