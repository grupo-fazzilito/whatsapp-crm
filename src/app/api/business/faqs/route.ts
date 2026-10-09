import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parseFaq } from '@/lib/business/setup-input'
import { assertOwned, badRequest, errorResponse, readBody } from '@/lib/business/setup-server'

/**
 * GET  /api/business/faqs → { faqs, agents } (members; oldest first)
 * POST /api/business/faqs { question, answer, keywords?, ai_agent_ids? } (admins) → { faq }
 *   ai_agent_ids empty/null = every agent.
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  try {
    const [faqs, agents] = await Promise.all([
      db.faqs.findMany({ select: { id: true, question: true, answer: true, keywords: true, ai_agent_ids: true }, orderBy: { created_at: 'asc' } }),
      db.ai_agents.findMany({ select: { id: true, name: true }, orderBy: { created_at: 'asc' } }),
    ])
    return NextResponse.json({ faqs, agents })
  } catch (err) {
    return errorResponse('business/faqs', err)
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  try {
    const data = parseFaq(body, false) as { question: string; answer: string; ai_agent_ids?: string[] }
    await assertOwned(db, 'ai_agents', data.ai_agent_ids ?? [])
    const faq = await db.faqs.create({ data: { ...data, workspace_id: workspace.id } })
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ faq })
  } catch (err) {
    return errorResponse('business/faqs', err)
  }
}
