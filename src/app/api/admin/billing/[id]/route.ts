import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { prisma } from '@/lib/db/prisma'
import { isUuid } from '@/lib/workspace/constants'

type Ctx = { params: Promise<{ id: string }> }

/**
 * GET /api/admin/billing/:workspaceId[?usage=0] → the business's token
 * history (who added or removed tokens and why) and its live lots.
 * usage=0 leaves out the AI consumption, so gifts and purchases aren't buried.
 */
export async function GET(request: Request, { params }: Ctx) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const withUsage = new URL(request.url).searchParams.get('usage') !== '0'

  // Platform client: the superadmin reads any workspace by id.
  const ws = await prisma.workspaces.findUnique({ where: { id }, select: { id: true, name: true } })
  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const [ledger, lots] = await Promise.all([
    prisma.credit_ledger.findMany({
      where: { workspace_id: id, ...(withUsage ? {} : { kind: { not: 'usage' } }) },
      select: {
        id: true, kind: true, credits: true, action: true, note: true, created_at: true,
        users: { select: { name: true, email: true } },
        billing_payments: { select: { amount: true, provider_order_id: true } },
      },
      orderBy: { created_at: 'desc' },
      take: 300,
    }),
    prisma.credit_lots.findMany({
      where: { workspace_id: id, credits_remaining: { gt: 0 }, expires_at: { gt: new Date() } },
      select: { id: true, source: true, credits_total: true, credits_remaining: true, expires_at: true, note: true },
      orderBy: { expires_at: 'asc' },
    }),
  ])

  return NextResponse.json({
    workspace: ws,
    ledger: ledger.map(({ id, users, billing_payments, ...l }) => ({
      ...l,
      id: id.toString(),
      by: users ? users.name || users.email : null,
      payment: billing_payments ? { amount: Number(billing_payments.amount), order: billing_payments.provider_order_id } : null,
    })),
    lots,
  })
}
