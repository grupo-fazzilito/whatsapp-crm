import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parseService } from '@/lib/business/setup-input'
import { badRequest, errorResponse, readBody } from '@/lib/business/setup-server'

/**
 * GET  /api/business/services → { services } (members; by category, then name)
 * POST /api/business/services { name, description?, category?, price?, price_is_from?, duration_minutes?, is_active? } (admins) → { service }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const services = await guard.ctx.db.services.findMany({
      orderBy: [{ category: { sort: 'asc', nulls: 'last' } }, { name: 'asc' }],
    })
    return NextResponse.json({ services })
  } catch (err) {
    return errorResponse('business/services', err)
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  try {
    const service = await guard.ctx.db.services.create({ data: { ...(parseService(body, false) as { name: string }), workspace_id: guard.ctx.workspace.id } })
    invalidateBusinessContext(guard.ctx.workspace.id)
    return NextResponse.json({ service })
  } catch (err) {
    return errorResponse('business/services', err)
  }
}
