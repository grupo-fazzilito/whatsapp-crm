import 'server-only'
import type { TenantDb } from '@/lib/db/tenant'
import { InputError, isUuid, parseStaff } from '@/lib/business/setup-input'
import { assertOwned } from '@/lib/business/setup-server'

/** Validated staff columns; member_user_id must be a member of this workspace. */
export async function staffData(db: TenantDb, body: Record<string, unknown>, partial: boolean) {
  const data = parseStaff(body, partial)
  if (typeof data.member_user_id === 'string') {
    const member = await db.workspace_members.count({ where: { user_id: data.member_user_id } })
    if (!member) throw new InputError('member_user_id is not a member of this workspace')
  }
  return data
}

/** service_ids from the body (undefined = leave links alone). */
export function serviceIdsOf(body: Record<string, unknown>): string[] | undefined {
  if (!('service_ids' in body)) return undefined
  const v = body.service_ids
  if (!Array.isArray(v) || !v.every(isUuid)) throw new InputError('service_ids must be a list of ids')
  return [...new Set(v as string[])]
}

/** Makes the staff member's linked services exactly `serviceIds`. */
export async function syncStaffServices(db: TenantDb, workspaceId: string, staffId: string, serviceIds: string[]) {
  await assertOwned(db, 'services', serviceIds)
  const current = await db.staff_services.findMany({ select: { service_id: true }, where: { staff_id: staffId } })
  const have = new Set(current.map((l) => l.service_id))
  const toRemove = [...have].filter((id) => !serviceIds.includes(id))
  const toAdd = serviceIds.filter((id) => !have.has(id))
  if (toRemove.length) await db.staff_services.deleteMany({ where: { staff_id: staffId, service_id: { in: toRemove } } })
  if (toAdd.length) {
    await db.staff_services.createMany({
      data: toAdd.map((service_id) => ({ staff_id: staffId, service_id, workspace_id: workspaceId })),
      skipDuplicates: true,
    })
  }
}
