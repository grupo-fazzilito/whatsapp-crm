import { NextResponse } from 'next/server'
import { isUuid } from '@/lib/workspace/constants'
import { voiceAuthorized } from '@/lib/calls/ai-session'
import { runVoiceTool } from '@/lib/calls/ai'

/**
 * POST /api/voice/calls/[id]/tool — the voice service (Bearer VOICE_SERVICE_SECRET).
 * { name, arguments } → { result } for the AI on the call.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!voiceAuthorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as { name?: unknown; arguments?: unknown } | null
  if (typeof body?.name !== 'string') return NextResponse.json({ error: 'name is required' }, { status: 400 })
  const args = body.arguments && typeof body.arguments === 'object' ? (body.arguments as Record<string, unknown>) : {}
  return NextResponse.json({ result: await runVoiceTool(id, body.name, args) })
}
