import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { prisma } from '@/lib/db/prisma'

/**
 * GET /api/admin/billing → per-workspace credits and this month's sales vs.
 * AI cost, plus the latest payments.
 */
export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // Platform client: totals across every workspace for the superadmin.
  const db = prisma
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const since = monthStart
  const now = new Date()

  // A failed query reads as no rows, as before.
  const safe = <T,>(p: Promise<T[]>) => p.then((data) => ({ data }), (err) => {
    console.error('[admin/billing] query failed:', err instanceof Error ? err.message : err)
    return { data: null as T[] | null }
  })
  const [workspaces, lots, paidMonth, usageMonth, costMonth, payments] = await Promise.all([
    safe(db.workspaces.findMany({ select: { id: true, name: true, industry: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 500 })),
    safe(db.credit_lots.findMany({ select: { workspace_id: true, credits_remaining: true }, where: { credits_remaining: { gt: 0 }, expires_at: { gt: now } }, take: 20000 })),
    safe(db.billing_payments.findMany({ select: { workspace_id: true, amount: true }, where: { status: 'paid', paid_at: { gte: since } }, take: 20000 })),
    safe(db.credit_ledger.findMany({ select: { workspace_id: true, credits: true }, where: { kind: 'usage', created_at: { gte: since } }, take: 50000 })),
    safe(db.ai_usage.findMany({ select: { workspace_id: true, cost_usd: true }, where: { created_at: { gte: since } }, take: 100000 })),
    safe(
      db.billing_payments
        .findMany({
          select: { id: true, workspace_id: true, amount: true, credits: true, status: true, provider_order_id: true, paid_at: true, error: true, created_at: true, workspaces: { select: { name: true } } },
          orderBy: { created_at: 'desc' },
          take: 50,
        })
        .then((list) => list.map(({ workspaces: workspace, ...p }) => ({ ...p, workspace }))),
    ),
  ])

  const sum = <T,>(rows: T[] | null, key: (r: T) => string, val: (r: T) => number) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(key(r), (m.get(key(r)) ?? 0) + val(r))
    return m
  }
  const balance = sum(lots.data, (r) => r.workspace_id, (r) => r.credits_remaining)
  const sales = sum(paidMonth.data, (r) => r.workspace_id, (r) => Number(r.amount))
  const used = sum(usageMonth.data, (r) => r.workspace_id, (r) => -r.credits)
  const cost = sum(costMonth.data, (r) => r.workspace_id, (r) => Number(r.cost_usd))

  const rows = (workspaces.data ?? []).map((w) => ({
    id: w.id,
    name: w.name,
    industry: w.industry,
    balance: balance.get(w.id) ?? 0,
    sales_month: sales.get(w.id) ?? 0,
    credits_used_month: used.get(w.id) ?? 0,
    ai_cost_usd_month: cost.get(w.id) ?? 0,
  }))
  const total = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

  return NextResponse.json({
    totals: { sales_month: total(sales), credits_used_month: total(used), ai_cost_usd_month: total(cost), credits_outstanding: total(balance) },
    workspaces: rows,
    payments: payments.data ?? [],
  })
}
