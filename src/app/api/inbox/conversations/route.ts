import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { listInboxConversations } from '@/lib/inbox/queries'

/**
 * GET /api/inbox/conversations[?id=<uuid>] → { conversations }
 * Inbox list rows (conversation + contact with its tag ids + conversation
 * tags), newest activity first. `id` returns just that one (or none).
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const id = new URL(request.url).searchParams.get('id')
  if (id !== null && !isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    const conversations = await listInboxConversations(guard.ctx.db, id ? { id } : {})
    return NextResponse.json({ conversations })
  } catch (err) {
    console.error('[inbox] conversations failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load conversations' }, { status: 500 })
  }
}
