import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { prisma } from '@/lib/db/prisma'
import { checkRateLimit } from '@/lib/rate-limit'
import { zonedTimeToUtc } from '@/lib/bookings/reminders'
import { backupZipStream } from '@/lib/backup/datasets'
import { localDay, zipFileName } from '@/lib/backup/datasets-format'
import { nextDay, parseBackupParams } from '@/lib/backup/params'
import { siteUrl } from '@/lib/real-estate/listing/url'

/**
 * GET /api/backup?datasets=conversations,contacts,products,automations,templates
 *   &from=YYYY-MM-DD&to=YYYY-MM-DD&internal=1&lang=es   (admins)
 * One ZIP with a file per dataset (all of them when `datasets` is left
 * out) plus a read-me. The dates and internal notes only apply to the
 * conversations; days are the business's own (its time zone), `to` included.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const parsed = parseBackupParams(new URL(request.url).searchParams)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const p = parsed.params
  // Same budget as the conversations CSV: a full backup reads the whole history.
  const limited = checkRateLimit(`backup:${ws}`, { limit: 5, windowMs: 60 * 60_000 })
  if (!limited.success) return NextResponse.json({ error: 'too_many_attempts' }, { status: 429 })

  const row = await prisma.workspaces.findUnique({ where: { id: ws }, select: { timezone: true, locale: true } })
  const timeZone = row?.timezone || 'UTC'
  const lang = p.lang ?? (row?.locale === 'en' ? 'en' : 'es')
  const generatedAt = new Date()
  const stream = backupZipStream({
    workspaceId: ws,
    datasets: p.datasets,
    from: p.from ? zonedTimeToUtc(p.from, '00:00', timeZone) : null,
    to: p.to ? zonedTimeToUtc(nextDay(p.to), '00:00', timeZone) : null,
    fromDay: p.from,
    toDay: p.to,
    includeInternal: p.includeInternal,
    timeZone,
    lang,
    origin: siteUrl(),
    generatedAt,
  })
  const name = zipFileName(lang, localDay(generatedAt, timeZone))
  return new Response(stream, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Cache-Control': 'no-store',
    },
  })
}
