import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
  const db = supabaseAdmin()
  const cutoff = new Date(now - DAY_MS).toISOString()
  const out: ScheduledResult = { mercadolibre: 0, feeds: 0, errors: 0 }
  let budget = MAX_PER_TICK

  const { data: conns } = await db
    .from('portal_connections')
    .select('workspace_id, last_import_at')
    .eq('provider', 'mercadolibre')
    .eq('status', 'active')
    .eq('auto_import', true)
    .or(`last_import_at.is.null,last_import_at.lt.${cutoff}`)
    .order('last_import_at', { ascending: true, nullsFirst: true })
    .limit(budget)
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
    const { data: feeds } = await db
      .from('portal_feeds')
      .select('*')
      .eq('schedule', 'daily')
      .or(`last_run_at.is.null,last_run_at.lt.${cutoff}`)
      .order('last_run_at', { ascending: true, nullsFirst: true })
      .limit(budget)
    for (const f of (feeds ?? []) as FeedRow[]) {
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
