import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseRecipientUpdates, recordBroadcastProgress } from '@/lib/broadcasts/audience'

/**
 * POST /api/broadcasts/[id]/progress — admins.
 * { recipients?: [{ id, status: 'sent'|'failed', whatsapp_message_id?, error_message? }], status?: 'sent'|'failed' }
 * Stores send results of this broadcast's recipients and, with `status`,
 * its final status (aggregate counts come from the DB trigger). → { ok }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const updates = parseRecipientUpdates(body.recipients)
  if (!updates) return NextResponse.json({ error: 'invalid recipients' }, { status: 400 })
  const status = body.status === undefined ? undefined : body.status
  if (status !== undefined && status !== 'sent' && status !== 'failed') return NextResponse.json({ error: 'invalid status' }, { status: 400 })
  try {
    if (!(await recordBroadcastProgress(guard.ctx.db, id, updates, status))) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[broadcasts] progress failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to record progress' }, { status: 500 })
  }
}
