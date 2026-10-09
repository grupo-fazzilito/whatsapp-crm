import { apiRoute } from '@/lib/public-api/http'
import { removeTag } from '@/lib/public-api/contacts'

export const DELETE = apiRoute<{ id: string; tagId: string }>({ resource: 'contacts', access: 'write' }, ({ ctx, params }) =>
  removeTag(ctx.workspace.id, params.id, params.tagId),
)
