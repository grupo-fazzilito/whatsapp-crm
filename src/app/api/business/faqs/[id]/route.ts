import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parseFaq } from '@/lib/business/setup-input'
import { assertOwned, badRequest, errorResponse, idParam, notFound, readBody } from '@/lib/business/setup-server'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH  /api/business/faqs/[id] { question?, answer?, keywords?, ai_agent_ids? } (admins) → { ok }
 * DELETE /api/business/faqs/[id] (admins) → { ok }
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
    const data = parseFaq(body, true) as { ai_agent_ids?: string[] }
    await assertOwned(db, 'ai_agents', data.ai_agent_ids ?? [])
    const { count } = await db.faqs.updateMany({ where: { id }, data: { ...data, updated_at: new Date() } })
    if (!count) return notFound()
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/faqs', err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  try {
    const { count } = await guard.ctx.db.faqs.deleteMany({ where: { id } })
    if (!count) return notFound()
    invalidateBusinessContext(guard.ctx.workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/faqs', err)
  }
}
