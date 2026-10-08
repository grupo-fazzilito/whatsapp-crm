import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { getContact, updateContact } from '@/lib/public-api/contacts'

type P = { id: string }

export const GET = apiRoute<P>({ resource: 'contacts', access: 'read' }, async ({ ctx, params }) => ({ data: await getContact(ctx.workspace.id, params.id) }))

/** PATCH /api/v1/contacts/{id} {name?, phone?, email?, company?} */
export const PATCH = apiRoute<P>({ resource: 'contacts', access: 'write' }, async ({ ctx, params, request }) => ({
  data: await updateContact(ctx.workspace.id, params.id, await jsonBody(request)),
}))
