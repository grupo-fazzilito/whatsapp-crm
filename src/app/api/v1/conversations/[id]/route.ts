import { apiRoute } from '@/lib/public-api/http'
import { getConversation } from '@/lib/public-api/conversations'

export const GET = apiRoute<{ id: string }>({ resource: 'conversations', access: 'read' }, async ({ ctx, params }) => ({
  data: await getConversation(ctx.workspace.id, params.id),
}))
