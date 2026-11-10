import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

const COLOR_RE = /^#[0-9a-f]{3,8}$/i

/** PATCH /api/tags/[id] { name?, color?, ai_hint? } — admins. → { tag } */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const data: { name?: string; color?: string; ai_hint?: string | null } = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : ''
    if (!name) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
    data.name = name
  }
  if (typeof body.color === 'string' && COLOR_RE.test(body.color)) data.color = body.color
  if ('ai_hint' in body) data.ai_hint = typeof body.ai_hint === 'string' ? body.ai_hint.trim().slice(0, 300) || null : null
  try {
    const { count } = await guard.ctx.db.tags.updateMany({ where: { id }, data })
    if (!count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const tag = await guard.ctx.db.tags.findFirst({ where: { id } })
    return NextResponse.json({ tag })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

/** DELETE /api/tags/[id] — admins. Contact/conversation links cascade. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const { count } = await guard.ctx.db.tags.deleteMany({ where: { id } })
    if (!count) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
