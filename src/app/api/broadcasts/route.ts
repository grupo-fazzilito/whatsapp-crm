import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'

/**
 * GET  /api/broadcasts → { broadcasts } newest first (any member)
 * POST /api/broadcasts { name, template_name, template_language?, template_variables?, audience_filter? }
 *   Saves a draft (no recipients, nothing sent) — admins. → { broadcast }
 *   Sending goes through /api/whatsapp/broadcast.
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const broadcasts = await guard.ctx.db.broadcasts.findMany({ orderBy: { created_at: 'desc' } })
    return NextResponse.json({ broadcasts })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}

const json = (v: unknown) => (v && typeof v === 'object' ? (v as Prisma.InputJsonValue) : undefined)

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, user, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim() : ''
  const templateName = typeof body?.template_name === 'string' ? body.template_name.trim() : ''
  if (!name || !templateName) return NextResponse.json({ error: 'name and template_name are required' }, { status: 400 })
  const language = typeof body?.template_language === 'string' && body.template_language ? body.template_language : 'en_US'

  try {
    const broadcast = await db.broadcasts.create({
      data: {
        workspace_id: workspace.id,
        user_id: user.id,
        name: name.slice(0, 200),
        template_name: templateName,
        template_language: language,
        template_variables: json(body?.template_variables),
        audience_filter: json(body?.audience_filter),
        status: 'draft',
        total_recipients: 0,
        sent_count: 0,
        delivered_count: 0,
        read_count: 0,
        replied_count: 0,
        failed_count: 0,
      },
    })
    return NextResponse.json({ broadcast })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
