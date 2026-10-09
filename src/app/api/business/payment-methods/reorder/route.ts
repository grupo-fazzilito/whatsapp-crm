import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { isUuid } from '@/lib/business/setup-input'
import { badRequest, errorResponse, readBody } from '@/lib/business/setup-server'

/**
 * POST /api/business/payment-methods/reorder { ids: string[] } (admins)
 *   sort_order = position in `ids` (ids of other workspaces match nothing). → { ok }
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  const ids = body?.ids
  if (!Array.isArray(ids) || !ids.every(isUuid) || new Set(ids).size !== ids.length || ids.length > 500) {
    return badRequest('ids must be a list of distinct ids')
  }
  const { db, workspace } = guard.ctx
  try {
    for (const [i, id] of (ids as string[]).entries()) {
      await db.payment_methods.updateMany({ where: { id, sort_order: { not: i } }, data: { sort_order: i } })
    }
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/payment-methods', err)
  }
}
