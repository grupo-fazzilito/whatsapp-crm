import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { CALENDAR_MODES, type CalendarMode } from '@/lib/integrations/google/mode'
import { runAfterResponse, syncPendingBookings } from '@/lib/integrations/google/sync'
import { zonedNow, safeTimeZone } from '@/lib/ai/time'
import type { Prisma } from '@/generated/prisma/client'

const ACTIVE = ['pending', 'confirmed']

/**
 * PUT { mode: 'business' | 'staff' } (admins) — one general Google Calendar
 * or each professional's own. Upcoming bookings are pushed again, so their
 * events move to the calendar now in use.
 */
export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as { mode?: unknown } | null
  const mode = body?.mode as CalendarMode
  if (!CALENDAR_MODES.includes(mode)) return NextResponse.json({ error: 'invalid_mode' }, { status: 400 })
  const { db, workspace } = guard.ctx
  try {
    const row = await db.workspaces.findUniqueOrThrow({ where: { id: workspace.id }, select: { settings: true, timezone: true } })
    const settings = row.settings && typeof row.settings === 'object' && !Array.isArray(row.settings) ? (row.settings as Record<string, unknown>) : {}
    await db.workspaces.update({ where: { id: workspace.id }, data: { settings: { ...settings, calendar_mode: mode } as Prisma.InputJsonValue, updated_at: new Date() } })
    invalidateBusinessContext(workspace.id)
    const today = zonedNow(safeTimeZone(row.timezone)).date
    const upcoming = await db.bookings.findMany({ select: { id: true, google_sync_version: true }, where: { booking_date: { gte: today }, status: { in: ACTIVE } }, take: 500 })
    for (const b of upcoming) {
      await db.bookings.updateMany({ where: { id: b.id }, data: { google_sync_state: 'pending', google_sync_attempts: 0, google_sync_version: (b.google_sync_version ?? 0) + 1 } })
    }
    runAfterResponse(async () => {
      await syncPendingBookings(workspace.id, 100)
    })
    return NextResponse.json({ mode })
  } catch (err) {
    console.error('[google] mode change failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
}
