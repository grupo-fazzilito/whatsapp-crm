import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import { isUuid } from '@/lib/workspace/constants'

/** GET ?status=pending|delivered|failed → the endpoint's latest 50 deliveries, with the business name. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const status = new URL(request.url).searchParams.get('status')
  const rows = await prisma.platform_webhook_deliveries.findMany({
    where: { endpoint_id: id, ...(status && ['pending', 'delivered', 'failed'].includes(status) ? { status } : {}) },
    select: { id: true, workspace_id: true, event_id: true, event_type: true, payload: true, status: true, attempts: true, next_attempt_at: true, last_attempt_at: true, response_status: true, response_body: true, error: true, duration_ms: true, created_at: true },
    orderBy: { created_at: 'desc' },
    take: 50,
  })
  const wsIds = [...new Set(rows.map((r) => r.workspace_id).filter((x): x is string => !!x))]
  const names = new Map(
    (wsIds.length ? await prisma.workspaces.findMany({ where: { id: { in: wsIds } }, select: { id: true, name: true } }) : []).map((w) => [w.id, w.name]),
  )
  return NextResponse.json({ deliveries: normalizeRaw(rows).map((r) => ({ ...r, workspace_name: r.workspace_id ? names.get(r.workspace_id) ?? null : null })) })
}
