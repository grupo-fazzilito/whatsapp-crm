import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { listConversationFiles, listMessages } from '@/lib/inbox/queries'

/**
 * GET /api/inbox/conversations/[id]/messages → { messages } (oldest first)
 * GET …?files=1 → { messages } media/document messages only (newest first, ≤ 300)
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const files = new URL(request.url).searchParams.get('files') === '1'
  try {
    const messages = files ? await listConversationFiles(guard.ctx.db, id) : await listMessages(guard.ctx.db, id)
    return NextResponse.json({ messages })
  } catch (err) {
    console.error('[inbox] messages failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load messages' }, { status: 500 })
  }
}
