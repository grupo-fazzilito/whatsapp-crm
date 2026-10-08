import { NextResponse } from 'next/server'
import { assistErrorResponse, assistGuard, visibleMessage } from '@/lib/ai/assist/http'
import { transcribeMessage } from '@/lib/ai/assist/service'

/**
 * POST /api/ai-assist/messages/[id]/transcribe   body: { force?: boolean }
 * Voice note → transcript (stored in messages.transcript, metered as
 * 'transcription'). → { transcript, cached }
 * 409 { code: 'no_provider' } when neither Gemini nor OpenAI is configured.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await assistGuard('media')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!(await visibleMessage(guard.ctx, id))) return NextResponse.json({ error: 'not_found', code: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { force?: unknown }
  try {
    const r = await transcribeMessage({ workspaceId: guard.ctx.workspace.id, messageId: id, force: body?.force === true })
    return NextResponse.json(r)
  } catch (err) {
    return assistErrorResponse(err)
  }
}
