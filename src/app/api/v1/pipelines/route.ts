import { apiRoute } from '@/lib/public-api/http'
import { listPipelines } from '@/lib/public-api/crm'

/** GET /api/v1/pipelines — pipelines with their stages (ids for deals). */
export const GET = apiRoute({ resource: 'crm', access: 'read' }, ({ ctx }) => listPipelines(ctx.workspace.id))
