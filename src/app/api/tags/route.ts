import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'

const COLOR_RE = /^#[0-9a-f]{3,8}$/i

/**
 * GET  /api/tags → { tags } oldest first (any member)
 * POST /api/tags { name, color? } → { tag } (any member, so agents can tag on the fly)
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const tags = await guard.ctx.db.tags.findMany({ orderBy: { created_at: 'asc' } })
    return NextResponse.json({ tags })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : ''
  if (!name) return NextResponse.json({ error: 'Tag name is required' }, { status: 400 })
  const color = typeof body?.color === 'string' && COLOR_RE.test(body.color) ? body.color : undefined

  try {
    const tag = await db.tags.create({ data: { workspace_id: workspace.id, user_id: user.id, name, ...(color ? { color } : {}) } })
    return NextResponse.json({ tag })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
