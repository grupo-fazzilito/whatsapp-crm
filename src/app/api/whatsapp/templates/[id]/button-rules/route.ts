import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseButtonRules } from '@/lib/templates/button-rules'
import type { Prisma } from '@/generated/prisma/client'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PUT { rules: { "<button text>": "<rule>" } } (admins) — what the AI agent
 * does when a customer presses each quick-reply button. Saved here only:
 * Meta never sees it, so it works on approved templates too. → { button_rules }
 */
export async function PUT(request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { rules?: unknown } | null
  const { db } = guard.ctx
  try {
    const row = await db.message_templates.findFirst({ select: { id: true, buttons: true }, where: { id } })
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 })
    const buttons = (Array.isArray(row.buttons) ? row.buttons : []) as { type: string; text: string }[]
    const rules = parseButtonRules(body?.rules, buttons.filter((b) => b && typeof b.text === 'string'))
    if (!rules) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
    await db.message_templates.updateMany({ where: { id }, data: { button_rules: rules as Prisma.InputJsonValue, updated_at: new Date() } })
    return NextResponse.json({ button_rules: rules })
  } catch (err) {
    console.error('[templates] button rules failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
