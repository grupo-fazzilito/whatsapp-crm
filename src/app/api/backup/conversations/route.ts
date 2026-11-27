import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { prisma } from '@/lib/db/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { zonedTimeToUtc } from '@/lib/bookings/reminders'
import { backupStream } from '@/lib/backup/messages-csv'
import { backupFileName } from '@/lib/backup/messages-format'
import { isDay, nextDay } from '@/lib/backup/params'
import { siteUrl } from '@/lib/real-estate/listing/url'

/**
 * GET /api/backup/conversations?from=YYYY-MM-DD&to=YYYY-MM-DD&internal=1&lang=es (admins)
 * Every message of the business as a CSV, oldest first. Days are the
 * business's own (its time zone); both are optional and `to` is included.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const url = new URL(request.url)
  const from = url.searchParams.get('from') || null
  const to = url.searchParams.get('to') || null
  if ((from && !isDay(from)) || (to && !isDay(to)) || (from && to && from > to)) {
    return NextResponse.json({ error: 'invalid_dates' }, { status: 400 })
  }
  // A full backup reads the whole history: a few per hour is plenty.
  const limited = checkRateLimit(`backup:${ws}`, { limit: 5, windowMs: 60 * 60_000 })
  if (!limited.success) return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })

  const row = await prisma.workspaces.findUnique({ where: { id: ws }, select: { timezone: true, locale: true } })
  const timeZone = row?.timezone || 'UTC'
  // The language of whoever downloads it (the app's), else the business's.
  const asked = url.searchParams.get('lang')
  const lang = asked === 'en' || asked === 'es' ? asked : row?.locale === 'en' ? 'en' : 'es'
  const stream = backupStream({
    workspaceId: ws,
    from: from ? zonedTimeToUtc(from, '00:00', timeZone) : null,
    to: to ? zonedTimeToUtc(nextDay(to), '00:00', timeZone) : null,
    includeInternal: url.searchParams.get('internal') === '1',
    timeZone,
    lang,
    origin: siteUrl(),
  })
  const name = backupFileName(lang, from, to)
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
