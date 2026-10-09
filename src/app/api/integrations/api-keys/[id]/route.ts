import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/** DELETE /api/integrations/api-keys/[id] — revokes the key (kept for the audit trail). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  let data
  try {
    const rows = await guard.ctx.db.api_keys.updateManyAndReturn({
      where: { id, workspace_id: guard.ctx.workspace.id, revoked_at: null },
      data: { revoked_at: new Date().toISOString() },
      select: { id: true, revoked_at: true },
    })
    data = rows[0] ?? null
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ key: data })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
