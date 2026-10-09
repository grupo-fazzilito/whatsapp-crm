import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/**
 * GET /api/automations/[id]/logs — any member.
 * → { automation (null when not in the workspace), logs: last 100 runs, newest first, each with contact {id, name, phone} }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ automation: null, logs: [] })

  try {
    const [automation, rows] = await Promise.all([
      db.automations.findFirst({ where: { id } }),
      db.automation_logs.findMany({
        where: { automation_id: id },
        include: { contacts: { select: { id: true, name: true, phone: true } } },
        orderBy: { created_at: 'desc' },
        take: 100,
      }),
    ])
    const logs = rows.map(({ contacts, ...log }) => ({ ...log, contact: contacts }))
    return NextResponse.json({ automation, logs })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
