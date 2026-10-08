import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { addTag, contactTags, getContactRow } from '@/lib/public-api/contacts'

type P = { id: string }

export const GET = apiRoute<P>({ resource: 'contacts', access: 'read' }, ({ ctx, params }) => contactTags(ctx.workspace.id, params.id))

/** POST /api/v1/contacts/{id}/tags {tag_id} | {name, color?} — creates the tag by name when missing. */
export const POST = apiRoute<P>(
  { resource: 'contacts', access: 'write' },
  async ({ ctx, params, request }) => {
    await getContactRow(ctx.workspace.id, params.id)
    const body = await jsonBody(request)
    return {
      data: await addTag(ctx.workspace.id, params.id, {
        tag_id: typeof body.tag_id === 'string' ? body.tag_id : null,
        name: typeof body.name === 'string' ? body.name : null,
        color: typeof body.color === 'string' ? body.color : null,
      }),
    }
  },
  { status: 201 },
)
