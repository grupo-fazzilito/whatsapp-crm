import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { getDeal, updateDeal } from '@/lib/public-api/crm'

type P = { id: string }

export const GET = apiRoute<P>({ resource: 'crm', access: 'read' }, async ({ ctx, params }) => ({ data: await getDeal(ctx.workspace.id, params.id) }))

export const PATCH = apiRoute<P>({ resource: 'crm', access: 'write' }, async ({ ctx, params, request }) => ({
  data: await updateDeal(ctx, params.id, await jsonBody(request)),
}))
