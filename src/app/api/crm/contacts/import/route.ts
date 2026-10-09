import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { clip } from '@/lib/crm/server'

const MAX_ROWS = 500

/**
 * POST /api/crm/contacts/import { rows: [{ phone, name?, email?, company? }] } — any member.
 * Inserts the batch; if it fails, row by row. → { imported, failed }
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as { rows?: unknown } | null
  if (!Array.isArray(body?.rows) || body.rows.length === 0 || body.rows.length > MAX_ROWS) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  let failed = 0
  const rows: { workspace_id: string; user_id: string; phone: string; name: string | null; email: string | null; company: string | null }[] = []
  for (const raw of body.rows as Record<string, unknown>[]) {
    const phone = clip(raw?.phone, 50)
    if (!phone) {
      failed++
      continue
    }
    rows.push({ workspace_id: workspace.id, user_id: user.id, phone, name: clip(raw.name, 200), email: clip(raw.email, 200), company: clip(raw.company, 200) })
  }
  let imported = 0
  if (rows.length) {
    try {
      imported = (await db.contacts.createMany({ data: rows })).count
    } catch {
      for (const row of rows) {
        try {
          await db.contacts.create({ data: row, select: { id: true } })
          imported++
        } catch {
          failed++
        }
      }
    }
  }
  return NextResponse.json({ imported, failed })
}
