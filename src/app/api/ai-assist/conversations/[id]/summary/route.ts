import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { assistErrorResponse, assistGuard, visibleConversation } from '@/lib/ai/assist/http'
import { summarizeConversation } from '@/lib/ai/assist/service'
import { parseStoredSummary } from '@/lib/ai/assist/core'

/** GET → the saved summary: { summary | null, at, by } */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!(await visibleConversation(guard.ctx, id))) return NextResponse.json({ error: 'not_found', code: 'not_found' }, { status: 404 })
  const { data } = await guard.ctx.supabase
    .from('conversations')
    .select('ai_summary, ai_summary_at, ai_summary_by')
    .eq('id', id)
    .eq('workspace_id', guard.ctx.workspace.id)
    .maybeSingle()
  return NextResponse.json({ summary: parseStoredSummary(data?.ai_summary), at: data?.ai_summary_at ?? null, by: data?.ai_summary_by ?? null })
}

/**
 * POST → (re)generates the summary with the text model (works with
 * DeepSeek; uses transcripts / AI media text, never internal notes),
 * saves it on the conversation and returns { summary, at, by }.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await assistGuard('summary')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!(await visibleConversation(guard.ctx, id))) return NextResponse.json({ error: 'not_found', code: 'not_found' }, { status: 404 })
  try {
    return NextResponse.json(await summarizeConversation({ workspaceId: guard.ctx.workspace.id, conversationId: id, userId: guard.ctx.user.id }))
  } catch (err) {
    return assistErrorResponse(err)
  }
}
