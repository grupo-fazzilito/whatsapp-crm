import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { badRequest, errorResponse } from '@/lib/business/setup-server'

const DAY = /^\d{4}-\d{2}-\d{2}$/

function instant(v: string | null): Date | null {
  if (!v) return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * GET /api/business/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&since=ISO&until=ISO[&bookings=1] (members)
 *   Bookings of [from, to] (when bookings=1), AI activity of [since, until) and setup counts.
 *   → { bookings, aiMessages, aiConversations, handedOver, setup: { hours, services, staff, faqs, agents } }
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const sp = new URL(request.url).searchParams
  const from = sp.get('from')
  const to = sp.get('to')
  const since = instant(sp.get('since'))
  const until = instant(sp.get('until'))
  if (!from || !to || !DAY.test(from) || !DAY.test(to) || !since || !until) return badRequest('Invalid period')
  const { db } = guard.ctx
  try {
    const [bookings, logs, hours, services, staff, faqs, agents] = await Promise.all([
      sp.get('bookings') === '1'
        ? db.bookings.findMany({
            select: {
              id: true,
              status: true,
              booking_date: true,
              booking_time: true,
              customer_name: true,
              services: { select: { name: true } },
              staff: { select: { name: true } },
            },
            where: { booking_date: { gte: from, lte: to } },
            orderBy: [{ booking_date: 'asc' }, { booking_time: 'asc' }],
            take: 2000,
          })
        : Promise.resolve([]),
      db.ai_chat_logs.findMany({
        select: { conversation_id: true, contact_id: true, detected_intent: true },
        where: { created_at: { gte: since, lt: until } },
        take: 5000,
      }),
      db.business_hours.count(),
      db.services.count(),
      db.staff.count(),
      db.faqs.count(),
      db.ai_agents.count(),
    ])
    const key = (r: { conversation_id: string | null; contact_id: string | null }) => r.conversation_id ?? r.contact_id ?? ''
    const convs = new Set(logs.map(key).filter(Boolean))
    const handed = new Set(logs.filter((r) => r.detected_intent === 'handover').map(key).filter(Boolean))
    return NextResponse.json({
      bookings: bookings.map(({ services: service, ...b }) => ({ ...b, service })),
      aiMessages: logs.length,
      aiConversations: convs.size,
      handedOver: handed.size,
      setup: { hours: hours > 0, services, staff, faqs, agents },
    })
  } catch (err) {
    return errorResponse('business/dashboard', err)
  }
}
