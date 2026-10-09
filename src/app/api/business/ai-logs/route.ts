import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/business/setup-input'
import { badRequest, errorResponse } from '@/lib/business/setup-server'

const PAGE = 50

/**
 * GET /api/business/ai-logs?offset=0[&agent=<id>&intent=<x>&since=ISO&until=ISO] (members)
 *   One page (50) of AI chat logs, newest first. → { logs }
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const sp = new URL(request.url).searchParams
  const offset = Math.max(0, Math.floor(Number(sp.get('offset') ?? 0)) || 0)
  const where: Record<string, unknown> = {}
  const agent = sp.get('agent')
  if (agent) {
    if (!isUuid(agent)) return badRequest('Invalid agent')
    where.ai_agent_id = agent
  }
  const intent = sp.get('intent')
  if (intent) where.detected_intent = intent.slice(0, 50)
  const created: Record<string, Date> = {}
  for (const [param, op] of [['since', 'gte'], ['until', 'lt']] as const) {
    const v = sp.get(param)
    if (!v) continue
    const d = new Date(v)
    if (Number.isNaN(d.getTime())) return badRequest(`Invalid ${param}`)
    created[op] = d
  }
  if (Object.keys(created).length) where.created_at = created
  try {
    const rows = await guard.ctx.db.ai_chat_logs.findMany({
      select: {
        id: true,
        created_at: true,
        user_message: true,
        ai_response: true,
        detected_intent: true,
        confidence_score: true,
        conversation_id: true,
        contacts: { select: { name: true, phone: true } },
        ai_agents: { select: { name: true } },
        channels: { select: { name: true, type: true } },
      },
      where,
      orderBy: { created_at: 'desc' },
      skip: offset,
      take: PAGE,
    })
    const logs = rows.map(({ contacts, ai_agents, channels, ...r }) => ({ ...r, contact: contacts, agent: ai_agents, channel: channels }))
    return NextResponse.json({ logs })
  } catch (err) {
    return errorResponse('business/ai-logs', err)
  }
}
