import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { previewAgentTurn } from '@/lib/ai/engine'
import { LlmUnavailableError, type ChatTurn } from '@/lib/ai/llm'
import type { AiAgentRow, BookingDraft } from '@/lib/ai/types'
import { canSpend, creditBalance, spend } from '@/lib/billing/credits'
import { actionCost } from '@/lib/billing/pricing'
import { getBillingSettings } from '@/lib/billing/settings'
import { previewOutbound } from '@/lib/agents/preview'

/**
 * POST /api/agents/[id]/playground — admin.
 * Body: { turns: [{ role: 'user'|'assistant', content }], draft?: BookingDraft,
 *         channel?: 'whatsapp'|'instagram'|'messenger'|'webchat' }
 * One model turn of the saved agent with the real prompt and business
 * data, without side effects (nothing is sent, booked or stored).
 * Each answer spends the 'playground' credit cost (free or paid credits).
 * Returns { reply, intent, handover, transferTo, bookingAction, draft, draftLabels,
 *   catalogSearch, showProductIds, shownProducts: [{ id, name, image }],
 *   messages: OutboundContent[] (what the channel would receive, in order),
 *   credits: { cost, balance } }.
 * 402 { code: 'no_credits' } without credits; 503 { code: 'llm_unavailable' } without an AI provider.
 */

const MAX_TURNS = 40
const CHANNELS = ['whatsapp', 'instagram', 'messenger', 'webchat'] as const
type PreviewChannel = (typeof CHANNELS)[number]
const MAX_CONTENT = 2000

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status })
}

function parseTurns(raw: unknown): ChatTurn[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const turns: ChatTurn[] = []
  for (const t of raw.slice(-MAX_TURNS)) {
    if (!t || typeof t !== 'object') return null
    const { role, content } = t as Record<string, unknown>
    if ((role !== 'user' && role !== 'assistant') || typeof content !== 'string') return null
    const text = content.trim().slice(0, MAX_CONTENT)
    if (!text) continue
    const last = turns[turns.length - 1]
    // Providers want alternating roles.
    if (last && last.role === role) last.content += `\n${text}`
    else turns.push({ role, content: text })
  }
  while (turns.length && turns[0].role !== 'user') turns.shift()
  if (!turns.length || turns[turns.length - 1].role !== 'user') return null
  return turns
}

const DRAFT_STRINGS = ['service_id', 'staff_id', 'product_id', 'date', 'time', 'customer_name'] as const

function parseDraft(raw: unknown): BookingDraft {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const src = raw as Record<string, unknown>
  const draft: BookingDraft = {}
  for (const k of DRAFT_STRINGS) {
    if (typeof src[k] === 'string' && (src[k] as string).trim()) draft[k] = (src[k] as string).trim().slice(0, 200)
  }
  if (typeof src.party_size === 'number' && src.party_size > 0) draft.party_size = Math.round(src.party_size)
  if (src.fields && typeof src.fields === 'object' && !Array.isArray(src.fields)) {
    const fields: Record<string, string | number | null> = {}
    for (const [k, v] of Object.entries(src.fields as Record<string, unknown>).slice(0, 20)) {
      if (typeof v === 'string' || typeof v === 'number') fields[k.slice(0, 60)] = typeof v === 'string' ? v.slice(0, 500) : v
    }
    draft.fields = fields
  }
  return draft
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const wsId = guard.ctx.workspace.id

  const { id } = await ctx.params
  if (!isUuid(id)) return bad('Not found', 404)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return bad('Invalid JSON body')
  const turns = parseTurns(body.turns)
  if (!turns) return bad('turns must be a non-empty list of {role, content} ending with a user message')
  const draft = parseDraft(body.draft)
  const channel: PreviewChannel = (CHANNELS as readonly unknown[]).includes(body.channel) ? (body.channel as PreviewChannel) : 'webchat'

  const db = guard.ctx.db
  const agent = await db.ai_agents.findFirst({ where: { id, workspace_id: wsId } })
  if (!agent) return bad('Not found', 404)

  // Testing an agent uses the AI like a real answer: it spends credits.
  if (!(await canSpend(wsId, 'playground'))) {
    return NextResponse.json({ error: 'No credits left', code: 'no_credits' }, { status: 402 })
  }

  try {
    const result = await previewAgentTurn({ workspaceId: wsId, agent: agent as unknown as AiAgentRow, turns, draft, channelType: channel })
    const [messages, settings] = await Promise.all([
      previewOutbound({ workspace: guard.ctx.workspace, skills: agent.skills, reply: result.reply, showProductIds: result.showProductIds }),
      getBillingSettings(),
    ])
    const balanceAfter = await spend(wsId, 'playground')

    // Human-readable names for the ids in the draft.
    const [service, staff, shown] = await Promise.all([
      result.draft.service_id && isUuid(result.draft.service_id)
        ? db.services.findFirst({ select: { name: true }, where: { id: result.draft.service_id, workspace_id: wsId } })
        : Promise.resolve(null),
      result.draft.staff_id && isUuid(result.draft.staff_id)
        ? db.staff.findFirst({ select: { name: true }, where: { id: result.draft.staff_id, workspace_id: wsId } })
        : Promise.resolve(null),
      // Products the agent would send as photos.
      result.showProductIds.length
        ? db.products.findMany({ select: { id: true, name: true, images: true }, where: { id: { in: result.showProductIds.filter(isUuid) }, workspace_id: wsId } })
        : Promise.resolve([]),
    ])
    const byId = new Map((shown as { id: string; name: string; images: string[] | null }[]).map((p) => [p.id, p]))

    return NextResponse.json({
      ...result,
      draftLabels: {
        service: service?.name ?? null,
        staff: staff?.name ?? null,
      },
      shownProducts: result.showProductIds
        .map((pid) => byId.get(pid))
        .filter((p) => !!p)
        .map((p) => ({ id: p!.id, name: p!.name, image: p!.images?.[0] ?? null })),
      channel,
      messages,
      credits: { cost: actionCost('playground', settings), balance: balanceAfter ?? (await creditBalance(wsId).catch(() => null)) },
    })
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      return NextResponse.json({ error: err.message, code: 'llm_unavailable' }, { status: 503 })
    }
    console.error('[agents/playground] preview failed:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'The model could not answer', code: 'llm_error' },
      { status: 502 },
    )
  }
}
