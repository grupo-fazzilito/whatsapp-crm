import { NextResponse } from 'next/server'
import { cronGuard, processBookingReminders } from '@/lib/bookings/server'

/**
 * Cron: sends 24h / 4h / 2h booking reminders for every workspace, judged
 * in each workspace's time zone. Protect with AUTOMATION_CRON_SECRET via
 * the `x-cron-secret` header (or ?secret=). Run every 15–30 minutes.
 */
async function handle(request: Request) {
  const denied = cronGuard(request)
  if (denied) return denied
  try {
    const result = await processBookingReminders()
    return NextResponse.json({ success: true, ...result })
  } catch (err) {
    console.error('[bookings] reminders cron failed:', err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Internal Server Error' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
