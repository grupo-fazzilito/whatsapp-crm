import { after, NextResponse } from 'next/server'
import { isUuid } from '@/lib/workspace/constants'
import { prisma } from '@/lib/db/prisma'
import { loadChannel } from '@/lib/channels/store'
import { voiceAuthorized } from '@/lib/calls/ai-session'
import { finishAiCall } from '@/lib/calls/ai'

/**
 * POST /api/voice/calls/[id]/end — the voice service (Bearer VOICE_SERVICE_SECRET).
 * { transcript: [{role, text, at}], hangup: boolean, reason } once the AI call is over.
 * hangup = the AI ended it (goodbye or time limit): we hang up on WhatsApp.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!voiceAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { transcript?: unknown; hangup?: unknown; reason?: unknown } | null
  const row = await prisma.whatsapp_calls.findFirst({ where: { id }, select: { workspace_id: true } })
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  after(() =>
    finishAiCall(
      id,
      { transcript: body?.transcript, hangup: body?.hangup === true, reason: typeof body?.reason === 'string' ? body.reason.slice(0, 100) : null },
      (channelId) => loadChannel(row.workspace_id, channelId),
    ).catch((err) => console.error('[voice] end failed:', err instanceof Error ? err.message : err)),
  )
  return NextResponse.json({ ok: true })
}
