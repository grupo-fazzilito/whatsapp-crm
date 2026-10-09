import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { syncPayment } from '@/lib/billing/payments'

/** POST /api/billing/payments/:id/sync (admins) — "I already paid": re-check with Payment Latam now. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  const own = await guard.ctx.db.billing_payments.findFirst({ where: { id }, select: { id: true } }).catch(() => null)
  if (!own) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const payment = await syncPayment(id)
  return NextResponse.json({ payment })
}
