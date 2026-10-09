import { NextResponse } from 'next/server'
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
  const db = guard.ctx.db

  const [cfg, conn, feeds, runs, imported] = await Promise.all([
    getMlConfig(),
    getMlConnection(ws.id),
    db.portal_feeds
      .findMany({
        select: {
          id: true,
          name: true,
          portal: true,
          url: true,
          format: true,
          mapping: true,
          item_path: true,
          schedule: true,
          deactivate_missing: true,
          last_run_at: true,
          created_at: true,
        },
        orderBy: { created_at: 'asc' },
      })
      .catch(() => null),
    db.portal_import_runs
      .findMany({
        select: {
          id: true,
          source: true,
          feed_id: true,
          trigger: true,
          status: true,
          total: true,
          created: true,
          updated: true,
          deactivated: true,
          failed: true,
          errors: true,
          notes: true,
          error: true,
          started_at: true,
          finished_at: true,
        },
        orderBy: { started_at: 'desc' },
        take: 15,
      })
      .catch(() => null),
    db.products.count({ where: { external_source: { not: null } } }).catch(() => null),
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
    feeds: feeds ?? [],
    runs: runs ?? [],
    imported: imported ?? 0,
  })
}
