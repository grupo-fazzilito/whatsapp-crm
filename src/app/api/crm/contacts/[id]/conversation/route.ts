import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'

/** GET /api/crm/contacts/[id]/conversation — any member. The contact's latest chat → { id | null }. */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return NextResponse.json({ id: null })
  const conv = await guard.ctx.db.conversations.findFirst({
    select: { id: true },
    where: { contact_id: id },
    orderBy: { last_message_at: { sort: 'desc', nulls: 'last' } },
  })
  return NextResponse.json({ id: conv?.id ?? null })
}
