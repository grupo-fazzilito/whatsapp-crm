import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isPrismaError } from '@/lib/db/errors'

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/**
 * GET  /api/whatsapp/templates → { templates } every local template, newest first (any member)
 * POST /api/whatsapp/templates { name, body_text, category?, language?, header_type?, footer_text? }
 *   Creates a local Draft template (admins). → { template } | 409 duplicate name+language
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const templates = await guard.ctx.db.message_templates.findMany({ orderBy: { created_at: 'desc' } })
    return NextResponse.json({ templates })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = str(body?.name, 512)
  const bodyText = str(body?.body_text, 4096)
  if (!name || !bodyText) return NextResponse.json({ error: 'name and body_text are required' }, { status: 400 })

  try {
    const template = await db.message_templates.create({
      data: {
        workspace_id: workspace.id,
        user_id: user.id,
        name,
        body_text: bodyText,
        category: str(body?.category, 50) ?? 'Marketing',
        language: str(body?.language, 20) ?? 'en_US',
        header_type: str(body?.header_type, 50),
        footer_text: str(body?.footer_text, 1024),
        status: 'Draft',
      },
    })
    return NextResponse.json({ template })
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return NextResponse.json({ error: 'duplicate_template' }, { status: 409 })
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
