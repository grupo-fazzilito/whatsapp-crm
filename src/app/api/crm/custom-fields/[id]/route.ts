import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseFieldInput } from '@/lib/crm/custom-fields'

type Params = { params: Promise<{ id: string }> }

/** PATCH /api/crm/custom-fields/[id] { field_name, field_type, field_options? } — admins. → { field } */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const parsed = parseFieldInput(await request.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { db } = guard.ctx
  const clash = await db.custom_fields.findFirst({
    where: { id: { not: id }, field_name: { equals: parsed.field.field_name, mode: 'insensitive' } },
    select: { id: true },
  })
  if (clash) return NextResponse.json({ error: 'duplicate' }, { status: 409 })
  const { count } = await db.custom_fields.updateMany({
    where: { id },
    data: { ...parsed.field, field_options: parsed.field.field_options ?? undefined },
  })
  if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ field: await db.custom_fields.findFirst({ where: { id } }) })
}

/** DELETE /api/crm/custom-fields/[id] — admins. Removes the field and every contact's value for it. */
export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { db } = guard.ctx
  await db.contact_custom_values.deleteMany({ where: { custom_field_id: id } })
  const { count } = await db.custom_fields.deleteMany({ where: { id } })
  if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
