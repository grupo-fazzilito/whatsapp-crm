import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseAgentInput } from '@/lib/ai/agent-input'
import { deleteAgent, updateAgent } from '@/lib/ai/agents-store'

/**
 * PATCH  /api/agents/[id] { …same fields as POST /api/agents, all optional } → { agent } — admin
 * DELETE /api/agents/[id] → { ok } — admin
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const parsed = parseAgentInput(body, true)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  if (Object.keys(parsed.value).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  try {
    const agent = await updateAgent(guard.ctx.db, id, parsed.value)
    if (!agent) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ agent })
  } catch (err) {
    console.error('[agents] update failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to update agent' }, { status: 500 })
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  try {
    if (!(await deleteAgent(guard.ctx.db, id))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[agents] delete failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 })
  }
}
