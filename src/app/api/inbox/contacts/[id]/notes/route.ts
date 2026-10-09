import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { addContactNote } from '@/lib/inbox/queries'

const MAX_NOTE = 5000

/** POST /api/inbox/contacts/[id]/notes { note_text } → { note } */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as { note_text?: unknown } | null
  const text = typeof body?.note_text === 'string' ? body.note_text.trim() : ''
  if (!text) return NextResponse.json({ error: 'note_text is required' }, { status: 400 })
  if (text.length > MAX_NOTE) return NextResponse.json({ error: 'note_too_long', max: MAX_NOTE }, { status: 413 })
  const { db, workspace, user } = guard.ctx
  try {
    const note = await addContactNote(db, workspace.id, user.id, id, text)
    if (!note) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ note })
  } catch (err) {
    console.error('[inbox] add note failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to add note' }, { status: 500 })
  }
}
