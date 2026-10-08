import { NextResponse } from 'next/server'
import { assistErrorResponse, assistGuard, visibleConversation } from '@/lib/ai/assist/http'
import { suggestReply } from '@/lib/ai/assist/service'

/**
 * POST /api/ai-assist/conversations/[id]/suggest   body: { hint?: string }
 * Draft of the next reply in the voice of the conversation's AI agent
 * (or a neutral assistant) with the business context. Never sent:
 * the composer shows it for editing. → { draft }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await assistGuard('suggest')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!(await visibleConversation(guard.ctx, id))) return NextResponse.json({ error: 'not_found', code: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { hint?: unknown }
  const hint = typeof body?.hint === 'string' ? body.hint.slice(0, 300) : null
  try {
    return NextResponse.json(await suggestReply({ workspaceId: guard.ctx.workspace.id, conversationId: id, hint }))
  } catch (err) {
    return assistErrorResponse(err)
  }
}
