import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { loadChannel } from '@/lib/channels/store'
import { isUuid } from '@/lib/workspace/constants'
import { setCalling } from '@/lib/calls/server'
import { bad } from '../../_lib/shared'

/**
 * POST /api/channels/[id]/calling — admin. { enabled, use_business_hours? }
 * Turns WhatsApp calls on/off on the number (Meta call settings).
 * → { calling: { enabled, use_business_hours, tier, error, updated_at } }
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  if (!isUuid(id)) return bad('Not found', 404)
  const channel = await loadChannel(guard.ctx.workspace.id, id)
  if (!channel || channel.type !== 'whatsapp') return bad('Not found', 404)
  const body = (await request.json().catch(() => null)) as { enabled?: unknown; use_business_hours?: unknown } | null
  if (typeof body?.enabled !== 'boolean') return bad('enabled must be a boolean')
  const r = await setCalling(channel, { enabled: body.enabled, useBusinessHours: body.use_business_hours === true })
  if (r.ok) return NextResponse.json({ calling: r.state })
  return NextResponse.json({ error: r.error, message: r.message ?? null, calling: r.state ?? null }, { status: r.error === 'provider' ? 502 : 400 })
}
