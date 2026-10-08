import { NextResponse } from 'next/server'
import { feedErrorCode, importFile } from '@/lib/real-estate/portals/feed/import'
import { busyOr500, requirePortalsAdmin } from '../_lib/guard'
import { parsedFromBody } from '../_lib/input'

export const maxDuration = 300

/**
 * POST /api/real-estate/portals/file
 *   { text, format? } | { records }  + { mapping, label, item_path?, deactivate_missing? }
 * One-off import of a file exported by the agency (its CRM / portal
 * export / the "Plantilla portales inmobiliarios"). `label` names the
 * source so re-importing the same kind of file updates instead of
 * duplicating.
 */
export async function POST(request: Request) {
  const guard = await requirePortalsAdmin()
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const label = typeof body.label === 'string' ? body.label.trim() : ''
  if (!label || label.length > 60) return NextResponse.json({ error: 'label' }, { status: 400 })

  let parsed
  try {
    parsed = await parsedFromBody(body)
  } catch (e) {
    return NextResponse.json({ error: feedErrorCode(e) }, { status: 422 })
  }
  try {
    const result = await importFile(guard.ctx.workspace.id, {
      parsed,
      mapping: body.mapping,
      label,
      deactivateMissing: body.deactivate_missing === true,
      userId: guard.ctx.user.id,
    })
    return NextResponse.json(result, { status: result.error ? 422 : 200 })
  } catch (e) {
    return busyOr500(e, 'file import')
  }
}
