import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/admin/billing → per-workspace credits and this month's sales vs.
 * AI cost, plus the latest payments.
 */
export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const db = supabaseAdmin()
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)
  const since = monthStart.toISOString()
  const now = new Date().toISOString()

  const [workspaces, lots, paidMonth, usageMonth, costMonth, payments] = await Promise.all([
    db.from('workspaces').select('id, name, industry, created_at').order('created_at', { ascending: false }).limit(500),
    db.from('credit_lots').select('workspace_id, credits_remaining').gt('credits_remaining', 0).gt('expires_at', now).limit(20000),
    db.from('billing_payments').select('workspace_id, amount').eq('status', 'paid').gte('paid_at', since).limit(20000),
    db.from('credit_ledger').select('workspace_id, credits').eq('kind', 'usage').gte('created_at', since).limit(50000),
    db.from('ai_usage').select('workspace_id, cost_usd').gte('created_at', since).limit(100000),
    db.from('billing_payments').select('id, workspace_id, amount, credits, status, provider_order_id, paid_at, error, created_at, workspace:workspaces(name)').order('created_at', { ascending: false }).limit(50),
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
