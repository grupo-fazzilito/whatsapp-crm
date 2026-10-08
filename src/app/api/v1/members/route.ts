import { apiRoute } from '@/lib/public-api/http'
import { listMembers } from '@/lib/public-api/crm'

/** GET /api/v1/members — active team members (user_id for assignments, profile_id for deals). */
export const GET = apiRoute({ resource: 'crm', access: 'read' }, ({ ctx }) => listMembers(ctx.workspace.id))
