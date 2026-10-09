import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { owns } from '@/lib/crm/server'

/** GET /api/crm/contacts/[id]/custom-values — any member. → { fields (by name), values } */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await ctx.params
  const [fields, values] = await Promise.all([
    db.custom_fields.findMany({ orderBy: { field_name: 'asc' } }),
    isUuid(id) ? db.contact_custom_values.findMany({ where: { contact_id: id } }) : [],
  ])
  return NextResponse.json({ fields, values })
}

/** PUT /api/crm/contacts/[id]/custom-values { values: { [custom_field_id]: string } } — any member; replaces all values. */
export async function PUT(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const { id } = await ctx.params
  const body = (await request.json().catch(() => null)) as { values?: unknown } | null
  const values = body?.values
  if (!values || typeof values !== 'object' || Array.isArray(values)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  if (!(await owns(db, 'contacts', id))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const rows = Object.entries(values as Record<string, unknown>)
    .filter(([, v]) => typeof v === 'string' && v.trim())
    .map(([fieldId, v]) => ({ workspace_id: workspace.id, contact_id: id, custom_field_id: fieldId, value: (v as string).trim().slice(0, 5000) }))
  const known = new Set((await db.custom_fields.findMany({ select: { id: true }, where: { id: { in: rows.map((r) => r.custom_field_id).filter(isUuid) } } })).map((f) => f.id))
  if (rows.some((r) => !known.has(r.custom_field_id))) return NextResponse.json({ error: 'invalid_field' }, { status: 400 })
  try {
    await db.contact_custom_values.deleteMany({ where: { contact_id: id } })
    if (rows.length) await db.contact_custom_values.createMany({ data: rows })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
