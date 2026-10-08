import { NextResponse } from 'next/server'
import { importFromMercadoLibre } from '@/lib/real-estate/portals/mercadolibre/import'
import { busyOr500, requirePortalsAdmin } from '../../_lib/guard'

export const maxDuration = 300

/** POST /api/real-estate/portals/mercadolibre/import → { runId, summary, error? } */
export async function POST() {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  try {
    const result = await importFromMercadoLibre(guard.ctx.workspace.id, { trigger: 'manual', userId: guard.ctx.user.id })
    return NextResponse.json(result, { status: result.error ? 502 : 200 })
  } catch (e) {
    return busyOr500(e, 'mercadolibre import')
  }
}
