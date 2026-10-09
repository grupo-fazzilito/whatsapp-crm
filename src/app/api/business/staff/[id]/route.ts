import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { badRequest, errorResponse, idParam, notFound, readBody } from '@/lib/business/setup-server'
import { serviceIdsOf, staffData, syncStaffServices } from '@/lib/business/staff-server'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH  /api/business/staff/[id] { …staff fields, service_ids? } (admins) → { id }
 *   service_ids, when sent, replaces the linked services.
 * DELETE /api/business/staff/[id] (admins) → { ok }
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  try {
    const data = await staffData(db, body, true)
    const serviceIds = serviceIdsOf(body)
    const { count } = await db.staff.updateMany({ where: { id }, data: { ...data, updated_at: new Date() } })
    if (!count) return notFound()
    if (serviceIds) await syncStaffServices(db, workspace.id, id, serviceIds)
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ id })
  } catch (err) {
    return errorResponse('business/staff', err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  try {
    const { count } = await guard.ctx.db.staff.deleteMany({ where: { id } })
    if (!count) return notFound()
    invalidateBusinessContext(guard.ctx.workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/staff', err)
  }
}
