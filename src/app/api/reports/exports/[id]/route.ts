import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { downloadObject } from '@/lib/storage'
import { EXPORT_TTL_DAYS } from '@/lib/reports/exports'
import { siteUrl } from '@/lib/integrations/google/endpoints'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET — downloads a ready PDF report (only the person who asked for it).
 * Not ready, failed or older than EXPORT_TTL_DAYS → back to Reports with
 * ?pdf=pending|failed|expired so the page can say so.
 */
export async function GET(_request: Request, { params }: Ctx) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await params
  const back = (state: string) => NextResponse.redirect(new URL(`/reports?pdf=${state}`, siteUrl()), { status: 303 })
  if (!isUuid(id)) return back('expired')
  const row = await guard.ctx.db.report_exports.findFirst({ where: { id, user_id: guard.ctx.user.id } }).catch(() => null)
  if (!row) return back('expired')
  if (row.status === 'pending') return back('pending')
  if (row.status !== 'ready' || !row.file_path) return back('failed')
  if (Date.now() - new Date(row.created_at).getTime() > EXPORT_TTL_DAYS * 86_400_000) return back('expired')
  try {
    const obj = await downloadObject('attachments', row.file_path)
    const name = (row.file_name ?? 'reporte.pdf').replace(/[^A-Za-z0-9._-]/g, '_')
    return new Response(new Uint8Array(obj.body), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Content-Length': String(obj.body.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return back('expired')
  }
}
