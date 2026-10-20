import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { loadChannel } from '@/lib/channels/store'
import { answerStep, claimCall, hangUp, rejectCall, releaseCall, type CallStepResult } from '@/lib/calls/server'

/**
 * POST /api/calls/[id] — agent. { action, sdp? }
 *   claim       take the ringing call → { sdp_offer } (409 when someone else did)
 *   pre_accept  { sdp } WebRTC answer, before the audio connects
 *   accept      { sdp } same answer, once connected: the call starts
 *   release     couldn't set up audio: back to ringing for the others
 *   reject      nobody takes it
 *   hangup      end the call
 */
const STATUS: Record<string, number> = { not_found: 404, taken: 409, not_yours: 403, ended: 410, provider: 502 }

function reply(r: CallStepResult<object>) {
  if (r.ok) return NextResponse.json(r)
  return NextResponse.json({ error: r.error, message: r.message ?? null }, { status: STATUS[r.error] ?? 400 })
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const ws = guard.ctx.workspace.id
  const userId = guard.ctx.user.id
  const body = (await request.json().catch(() => null)) as { action?: string; sdp?: unknown } | null
  const channelOf = (channelId: string) => loadChannel(ws, channelId)
  const sdp = typeof body?.sdp === 'string' && body.sdp.length < 20_000 ? body.sdp : ''

  switch (body?.action) {
    case 'claim': {
      const r = await claimCall(ws, id, userId)
      return r.ok ? NextResponse.json({ ok: true, sdp_offer: r.sdpOffer }) : reply(r)
    }
    case 'pre_accept':
    case 'accept':
      if (!sdp) return NextResponse.json({ error: 'sdp required' }, { status: 400 })
      return reply(await answerStep(ws, id, userId, body.action, sdp, channelOf))
    case 'release':
      await releaseCall(ws, id, userId)
      return NextResponse.json({ ok: true })
    case 'reject':
      return reply(await rejectCall(ws, id, channelOf))
    case 'hangup':
      return reply(await hangUp(ws, id, userId, channelOf))
    default:
      return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  }
}
