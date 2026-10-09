import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getSessionUser } from '@/lib/auth/session'
import { isUuid } from '@/lib/workspace/constants'
import { parseBody, TICKET_STATUSES, type TicketStatus } from '@/lib/support/input'
import { adminGetTicket, adminSetStatus, supportReply } from '@/lib/support/tickets'

type Ctx = { params: Promise<{ id: string }> }
const status = (v: unknown) => ((TICKET_STATUSES as readonly unknown[]).includes(v) ? (v as TicketStatus) : undefined)

/** GET → { ticket, messages }. POST { body, status? } replies. PATCH { status } changes the status. */
export async function GET(_r: Request, { params }: Ctx) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const found = isUuid(id) ? await adminGetTicket(id) : null
  return found ? NextResponse.json(found) : NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function POST(request: Request, { params }: Ctx) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await getSessionUser()
  const { id } = await params
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const body = parseBody(raw?.body)
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const result = isUuid(id) && admin ? await supportReply({ ticketId: id, adminId: admin.id, body, status: status(raw?.status) }) : null
  return result ? NextResponse.json(result) : NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function PATCH(request: Request, { params }: Ctx) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const s = status(raw?.status)
  if (!s) return NextResponse.json({ error: 'invalid_status' }, { status: 400 })
  if (!isUuid(id) || !(await adminSetStatus(id, s))) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(await adminGetTicket(id))
}
