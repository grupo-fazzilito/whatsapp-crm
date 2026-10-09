import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { InputError, mergeSettings, parseWorkspacePatch } from '@/lib/business/setup-input'
import { badRequest, errorResponse, readBody } from '@/lib/business/setup-server'
import type { Prisma } from '@/generated/prisma/client'

/**
 * PATCH /api/business/workspace (admins) — business setup of the active workspace.
 *   { name?, business_type_detail?, description?, phone?, email?, website?, address?, city?, state?,
 *     postal_code?, google_map_link?, country?, currency?, timezone?, locale?, industry?, date_exceptions?,
 *     settings?: { modules?, labels?, booking_capacity?, orders?, product_attributes? } }
 *   `settings` keys are merged into the latest stored settings (orders is merged one level deeper).
 *   → { ok }
 */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  try {
    const data: Record<string, unknown> = parseWorkspacePatch(body)
    if ('settings' in body) {
      const current = await db.workspaces.findUniqueOrThrow({ where: { id: workspace.id }, select: { settings: true } })
      data.settings = mergeSettings(current.settings, body.settings)
    }
    if (!Object.keys(data).length) throw new InputError('Nothing to update')
    await db.workspaces.update({ where: { id: workspace.id }, data: { ...(data as Prisma.workspacesUpdateInput), updated_at: new Date() } })
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/workspace', err)
  }
}
