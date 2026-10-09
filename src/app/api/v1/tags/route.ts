import { apiRoute } from '@/lib/public-api/http'
import { listTags } from '@/lib/public-api/contacts'

export const GET = apiRoute({ resource: 'contacts', access: 'read' }, ({ ctx }) => listTags(ctx.workspace.id))
