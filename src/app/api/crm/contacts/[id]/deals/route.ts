import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { contactDeals } from '@/lib/crm/server'

/**
 * GET /api/crm/contacts/[id]/deals?status=open&limit= — any member. Newest
 * first, with stage (all columns) and pipeline { name }. → { deals }
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ deals: [] })
  const sp = new URL(request.url).searchParams
  const status = sp.get('status')
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 100, 1), 500)
  try {
    return NextResponse.json({ deals: await contactDeals(guard.ctx.db, id, { status: status && ['open', 'won', 'lost'].includes(status) ? status : null, limit }) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
