import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { parseAgentInput } from '@/lib/ai/agent-input'
import { createAgent, listAgentsWithChannels } from '@/lib/ai/agents-store'

/**
 * GET  /api/agents → { agents (oldest first), channels: [{id, name, type, ai_agent_id}] } — any member
 * POST /api/agents { name, description?, persona?, tone?, instructions?, language?, skills?,
 *   greeting_message?, after_hours_message?, escalation_keywords?, business_hours_only?,
 *   enabled?, model?, transfer_agent_ids? } → { agent } — admin
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    return NextResponse.json(await listAgentsWithChannels(guard.ctx.db))
  } catch (err) {
    console.error('[agents] list failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load agents' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = parseAgentInput(body, false)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const { db, workspace, user } = guard.ctx
  try {
    return NextResponse.json({ agent: await createAgent(db, workspace.id, user.id, parsed.value) })
  } catch (err) {
    console.error('[agents] create failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to create agent' }, { status: 500 })
  }
}
