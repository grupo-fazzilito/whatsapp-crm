import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { importFeed, type FeedRow } from './feed/import'
import { importFromMercadoLibre } from './mercadolibre/import'
import { ImportBusyError } from './sync'

// Daily re-import, driven by the automations cron. Each tick runs at most
// MAX_PER_TICK imports (oldest first) so a single invocation stays short;
// the rest are picked up by the next ticks.

const DAY_MS = 23 * 60 * 60 * 1000
const MAX_PER_TICK = 3

export interface ScheduledResult {
  mercadolibre: number
  feeds: number
  errors: number
}

export async function runScheduledPortalImports(now = Date.now()): Promise<ScheduledResult> {
  // Cron across every workspace: platform client.
  const db = prisma
  const cutoff = new Date(now - DAY_MS).toISOString()
  const out: ScheduledResult = { mercadolibre: 0, feeds: 0, errors: 0 }
  let budget = MAX_PER_TICK

  const conns = await db.portal_connections
    .findMany({
      select: { workspace_id: true, last_import_at: true },
      where: { provider: 'mercadolibre', status: 'active', auto_import: true, OR: [{ last_import_at: null }, { last_import_at: { lt: cutoff } }] },
      orderBy: { last_import_at: { sort: 'asc', nulls: 'first' } },
      take: budget,
    })
    .catch(() => null)
  for (const c of conns ?? []) {
    if (budget <= 0) break
    budget--
    try {
      const r = await importFromMercadoLibre(c.workspace_id as string, { trigger: 'schedule' })
      if (r.error) out.errors++
      else out.mercadolibre++
    } catch (e) {
      if (!(e instanceof ImportBusyError)) out.errors++
    }
  }

  if (budget > 0) {
    const feeds = await db.portal_feeds
      .findMany({
        where: { schedule: 'daily', OR: [{ last_run_at: null }, { last_run_at: { lt: cutoff } }] },
        orderBy: { last_run_at: { sort: 'asc', nulls: 'first' } },
        take: budget,
      })
      .catch(() => null)
    for (const f of (feeds ?? []) as unknown as FeedRow[]) {
      try {
        const r = await importFeed(f, { trigger: 'schedule' })
        if (r.error) out.errors++
        else out.feeds++
      } catch (e) {
        if (!(e instanceof ImportBusyError)) out.errors++
      }
    }
  }
  return out
}
