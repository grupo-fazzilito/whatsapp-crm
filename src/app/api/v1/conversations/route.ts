import { apiRoute } from '@/lib/public-api/http'
import { listConversations } from '@/lib/public-api/conversations'

/** GET /api/v1/conversations?status&channel&assigned&contact_id&updated_since&limit&cursor (most recently updated first) */
export const GET = apiRoute({ resource: 'conversations', access: 'read' }, ({ ctx, url }) => listConversations(ctx.workspace.id, url))
