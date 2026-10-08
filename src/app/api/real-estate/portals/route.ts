import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getMlConfig } from '@/lib/real-estate/portals/mercadolibre/config'
import { getMlConnection } from '@/lib/real-estate/portals/mercadolibre/connection'
import { requirePortalsAdmin } from './_lib/guard'

/**
 * GET /api/real-estate/portals → overview for the "Importar desde portales" page:
 * { mercadolibre: { available, connection }, feeds, runs (last 15), counts }
 * Never returns tokens.
 */
export async function GET() {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace
  const db = supabaseAdmin()

  const [cfg, conn, feeds, runs, imported] = await Promise.all([
    getMlConfig(),
    getMlConnection(ws.id),
    db.from('portal_feeds').select('id, name, portal, url, format, mapping, item_path, schedule, deactivate_missing, last_run_at, created_at').eq('workspace_id', ws.id).order('created_at'),
    db.from('portal_import_runs').select('id, source, feed_id, trigger, status, total, created, updated, deactivated, failed, errors, notes, error, started_at, finished_at').eq('workspace_id', ws.id).order('started_at', { ascending: false }).limit(15),
    db.from('products').select('id', { count: 'exact', head: true }).eq('workspace_id', ws.id).not('external_source', 'is', null),
  ])

  return NextResponse.json({
    mercadolibre: {
      available: !!(cfg.clientId && cfg.clientSecret),
      site_id: cfg.site,
      connection: conn
        ? {
            nickname: conn.nickname,
            user_id: conn.external_user_id,
            site_id: conn.site_id,
            status: conn.status,
            last_error: conn.last_error,
            auto_import: conn.auto_import,
            last_import_at: conn.last_import_at,
            connected_at: conn.created_at,
          }
        : null,
    },
    feeds: feeds.data ?? [],
    runs: runs.data ?? [],
    imported: imported.count ?? 0,
  })
}
