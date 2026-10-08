import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { createTask, listTasks } from '@/lib/public-api/crm'

/** GET /api/v1/tasks?status&assignee_user_id&contact_id&deal_id&conversation_id&limit&cursor */
export const GET = apiRoute({ resource: 'crm', access: 'read' }, ({ ctx, url }) => listTasks(ctx.workspace.id, url))

/** POST /api/v1/tasks {title, description?, due_at?, priority?, assignee_user_id?, contact_id?, conversation_id?, deal_id?} */
export const POST = apiRoute(
  { resource: 'crm', access: 'write' },
  async ({ ctx, request }) => ({ data: await createTask(ctx, await jsonBody(request)) }),
  { status: 201 },
)
