import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { createContact, listContacts } from '@/lib/public-api/contacts'

/** GET /api/v1/contacts?limit&cursor&q&phone&email&tag_id&updated_since */
export const GET = apiRoute({ resource: 'contacts', access: 'read' }, ({ ctx, url }) => listContacts(ctx.workspace.id, url))

/** POST /api/v1/contacts {name?, phone?, email?, company?, tags?: string[]} */
export const POST = apiRoute(
  { resource: 'contacts', access: 'write' },
  async ({ ctx, request }) => ({ data: await createContact(ctx.workspace.id, await jsonBody(request)) }),
  { status: 201 },
)
