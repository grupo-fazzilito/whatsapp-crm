import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'

/**
 * GET /api/crm/contacts/search?q=&sort=recent|name&limit= — any member.
 * Name / phone substring (empty q: no filter). → { contacts: [{ id, name, phone }] }
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const sp = new URL(request.url).searchParams
  const q = (sp.get('q') ?? '').trim().slice(0, 100)
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 8, 1), 50)
  try {
    const contacts = await guard.ctx.db.contacts.findMany({
      select: { id: true, name: true, phone: true },
      where: q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q, mode: 'insensitive' } }] } : {},
      orderBy: sp.get('sort') === 'name' ? { name: 'asc' } : { updated_at: 'desc' },
      take: limit,
    })
    return NextResponse.json({ contacts })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
