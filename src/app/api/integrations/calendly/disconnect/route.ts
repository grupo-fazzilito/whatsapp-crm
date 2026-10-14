import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { disconnectCalendly } from '@/lib/integrations/calendly/sync'

/** POST (admins) — disconnects Calendly. Bookings already in Whasalia stay. */
export async function POST() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  await disconnectCalendly(guard.ctx.workspace.id)
  return NextResponse.json({ ok: true })
}
