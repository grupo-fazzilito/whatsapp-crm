import { NextResponse } from 'next/server'
import { assistErrorResponse, assistGuard, visibleMessage } from '@/lib/ai/assist/http'
import { readMessageMedia } from '@/lib/ai/assist/service'

/**
 * POST /api/ai-assist/messages/[id]/read   body: { force?: boolean }
 * "Leer con IA": image description / PDF text (messages.ai_media_text,
 * metered as 'vision'). → { text, cached }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await assistGuard('media')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!(await visibleMessage(guard.ctx, id))) return NextResponse.json({ error: 'not_found', code: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { force?: unknown }
  try {
    const r = await readMessageMedia({ workspaceId: guard.ctx.workspace.id, messageId: id, force: body?.force === true, purpose: 'inbox' })
    return NextResponse.json(r)
  } catch (err) {
    return assistErrorResponse(err)
  }
}
