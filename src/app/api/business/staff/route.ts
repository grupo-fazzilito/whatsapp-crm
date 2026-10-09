import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { badRequest, errorResponse, readBody } from '@/lib/business/setup-server'
import { serviceIdsOf, staffData, syncStaffServices } from '@/lib/business/staff-server'

/**
 * GET  /api/business/staff → { staff, services, links: { staff_id, service_id }[] } (members)
 * POST /api/business/staff { …staff fields, service_ids? } (admins) → { id }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  try {
    const [staff, services, links] = await Promise.all([
      db.staff.findMany({ orderBy: { name: 'asc' } }),
      db.services.findMany({ orderBy: { name: 'asc' } }),
      db.staff_services.findMany({ select: { staff_id: true, service_id: true } }),
    ])
    return NextResponse.json({ staff, services, links })
  } catch (err) {
    return errorResponse('business/staff', err)
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  try {
    const data = (await staffData(db, body, false)) as { name: string }
    const serviceIds = serviceIdsOf(body)
    const row = await db.staff.create({ data: { ...data, workspace_id: workspace.id }, select: { id: true } })
    if (serviceIds) await syncStaffServices(db, workspace.id, row.id, serviceIds)
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ id: row.id })
  } catch (err) {
    return errorResponse('business/staff', err)
  }
}
