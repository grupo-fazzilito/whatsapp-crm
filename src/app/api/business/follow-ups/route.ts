import { NextResponse } from 'next/server'
import { cronGuard, processBookingFollowUps } from '@/lib/bookings/server'

/**
 * Cron: post-visit messages for completed bookings — a feedback request
 * ~24h after completion and a check-in ~7 days after. Protect with
 * AUTOMATION_CRON_SECRET (`x-cron-secret`). Run hourly.
 */
async function handle(request: Request) {
  const denied = cronGuard(request)
  if (denied) return denied
  try {
    const result = await processBookingFollowUps()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[bookings] follow-ups cron failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
