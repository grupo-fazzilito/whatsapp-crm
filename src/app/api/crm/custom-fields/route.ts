import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { parseFieldInput } from '@/lib/crm/custom-fields'

/** GET /api/crm/custom-fields — any member. → { fields } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const fields = await guard.ctx.db.custom_fields.findMany({ orderBy: { created_at: 'asc' } })
  return NextResponse.json({ fields })
}

/** POST /api/crm/custom-fields { field_name, field_type, field_options? } — admins. → { field } */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const parsed = parseFieldInput(await request.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { db, workspace, user } = guard.ctx
  if (await db.custom_fields.findFirst({ where: { field_name: { equals: parsed.field.field_name, mode: 'insensitive' } }, select: { id: true } })) {
    return NextResponse.json({ error: 'duplicate' }, { status: 409 })
  }
  const field = await db.custom_fields.create({
    data: { workspace_id: workspace.id, user_id: user.id, ...parsed.field, field_options: parsed.field.field_options ?? undefined },
  })
  return NextResponse.json({ field })
}
