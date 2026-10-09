import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { errorResponse } from '@/lib/business/setup-server'

/** GET /api/business/ai-agents → { agents: { id, name }[] } (members; oldest first) */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const agents = await guard.ctx.db.ai_agents.findMany({ select: { id: true, name: true }, orderBy: { created_at: 'asc' } })
    return NextResponse.json({ agents })
  } catch (err) {
    return errorResponse('business/ai-agents', err)
  }
}
