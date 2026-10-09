import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parseService } from '@/lib/business/setup-input'
import { badRequest, errorResponse, idParam, notFound, readBody } from '@/lib/business/setup-server'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH  /api/business/services/[id] { …any service field } (admins) → { ok }
 * DELETE /api/business/services/[id] (admins) → { ok }
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  try {
    const data = parseService(body, true)
    const { count } = await guard.ctx.db.services.updateMany({ where: { id }, data: { ...data, updated_at: new Date() } })
    if (!count) return notFound()
    invalidateBusinessContext(guard.ctx.workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/services', err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  try {
    const { count } = await guard.ctx.db.services.deleteMany({ where: { id } })
    if (!count) return notFound()
    invalidateBusinessContext(guard.ctx.workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/services', err)
  }
}
