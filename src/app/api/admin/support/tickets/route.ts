import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { TICKET_STATUSES, type TicketStatus } from '@/lib/support/input'
import { adminListTickets } from '@/lib/support/tickets'

/** GET ?status=open|in_progress|waiting_customer|closed|active → { tickets, counts } (platform admin). */
export async function GET(request: Request) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const s = new URL(request.url).searchParams.get('status')
  const status = s === 'active' ? 'active' : (TICKET_STATUSES as readonly string[]).includes(s ?? '') ? (s as TicketStatus) : null
  return NextResponse.json(await adminListTickets(status))
}
