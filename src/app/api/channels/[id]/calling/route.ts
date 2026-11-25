import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { loadChannel } from '@/lib/channels/store'
import { isUuid } from '@/lib/workspace/constants'
import { setCalling, setCallAi } from '@/lib/calls/server'
import { aiCallBlock } from '@/lib/calls/ai'
import { readCallAi } from '@/lib/calls/ai-config'
import { getBillingSettings } from '@/lib/billing/settings'
import { actionCost } from '@/lib/billing/pricing'
import { bad } from '../../_lib/shared'

/**
 * POST /api/channels/[id]/calling — admin. { enabled, use_business_hours? }
 * Turns WhatsApp calls on/off on the number (Meta call settings).
 * → { calling: { enabled, use_business_hours, tier, error, updated_at } }
 *
 * GET   — admin. Who answers the calls → { ai, block, agents: [{id, name, enabled}], minute_cost }
 * PATCH — admin. { ai: CallAiConfig } → { ai, block }
 *   block: why the AI can't answer now (no_service | no_key | no_agent | no_tokens) or null.
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

async function loadWhatsApp(id: string) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return { response: guard.response }
  if (!isUuid(id)) return { response: bad('Not found', 404) }
  const channel = await loadChannel(guard.ctx.workspace.id, id)
  if (!channel || channel.type !== 'whatsapp') return { response: bad('Not found', 404) }
  return { channel, ctx: guard.ctx }
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await loadWhatsApp((await params).id)
  if ('response' in found) return found.response
  const ai = readCallAi(found.channel.settings)
  const [block, agents, billing] = await Promise.all([
    aiCallBlock(found.channel.workspace_id, ai),
    found.ctx.db.ai_agents.findMany({ select: { id: true, name: true, enabled: true }, orderBy: { created_at: 'asc' } }),
    getBillingSettings(),
  ])
  return NextResponse.json({ ai, block, agents, minute_cost: actionCost('call_minute', billing) })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const found = await loadWhatsApp((await params).id)
  if ('response' in found) return found.response
  const body = (await request.json().catch(() => null)) as { ai?: unknown } | null
  if (!body?.ai || typeof body.ai !== 'object') return bad('ai is required')
  const ai = await setCallAi(found.channel, body.ai)
  return NextResponse.json({ ai, block: ai.mode === 'humans' ? null : await aiCallBlock(found.channel.workspace_id, ai) })
}
