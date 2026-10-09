import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { badRequest, errorResponse, readBody } from '@/lib/business/setup-server'

const SELECT = { id: true, name: true, phone: true } as const

/**
 * GET  /api/bookings/contacts[?q=text] (members) → { contacts } — 8 most recently updated, matching name/phone.
 * POST /api/bookings/contacts { name?, phone? } (members) → { contact } — quick "new customer" from the booking form.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const term = (new URL(request.url).searchParams.get('q') ?? '').trim().slice(0, 100)
  try {
    const contacts = await guard.ctx.db.contacts.findMany({
      select: SELECT,
      where: term
        ? { OR: [{ name: { contains: term, mode: 'insensitive' } }, { phone: { contains: term, mode: 'insensitive' } }] }
        : {},
      orderBy: { updated_at: 'desc' },
      take: 8,
    })
    return NextResponse.json({ contacts })
  } catch (err) {
    return errorResponse('bookings/contacts', err)
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 200) : ''
  const phone = typeof body.phone === 'string' ? body.phone.trim().slice(0, 50) : ''
  if (!name && !phone) return badRequest('Name or phone is required')
  try {
    const contact = await guard.ctx.db.contacts.create({
      data: { name: name || phone, phone: phone || null, workspace_id: guard.ctx.workspace.id },
      select: SELECT,
    })
    return NextResponse.json({ contact })
  } catch (err) {
    return errorResponse('bookings/contacts', err)
  }
}
