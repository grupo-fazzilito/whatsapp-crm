import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { creditBalance } from '@/lib/billing/credits'
import { getBillingSettings, getPaymentLatamConfig } from '@/lib/billing/settings'

/**
 * GET /api/billing (admins) → balance, next expiry, prices, payer data,
 * recent payments, recent movements and this month's usage by action.
 */
export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace.id
  const db = supabaseAdmin()
  const monthStart = new Date()
  monthStart.setUTCDate(1)
  monthStart.setUTCHours(0, 0, 0, 0)

  const [balance, settings, gateway, account, lots, payments, ledger, usage] = await Promise.all([
    creditBalance(ws),
    getBillingSettings(),
    getPaymentLatamConfig(),
    db.from('billing_accounts').select('doc_type, doc_number, legal_name, email').eq('workspace_id', ws).maybeSingle(),
    db.from('credit_lots').select('credits_remaining, expires_at, source').eq('workspace_id', ws).gt('credits_remaining', 0).gt('expires_at', new Date().toISOString()).order('expires_at').limit(20),
    db.from('billing_payments').select('id, amount, credits, status, checkout_url, expires_on, paid_at, error, created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(20),
    db.from('credit_ledger').select('id, kind, credits, action, conversation_id, note, created_at').eq('workspace_id', ws).order('created_at', { ascending: false }).limit(50),
    db.from('credit_ledger').select('action, credits').eq('workspace_id', ws).eq('kind', 'usage').gte('created_at', monthStart.toISOString()).limit(20000),
  ])

  const byAction: Record<string, number> = {}
  for (const u of usage.data ?? []) byAction[u.action ?? 'other'] = (byAction[u.action ?? 'other'] ?? 0) - u.credits
  const next = lots.data?.[0] ?? null

  return NextResponse.json({
    balance,
    next_expiry: next ? { at: next.expires_at, credits: next.credits_remaining } : null,
    lots: lots.data ?? [],
    settings: {
      credit_price: settings.credit_price,
      min_topup: settings.min_topup,
      packs: settings.packs,
      expiry_months: settings.expiry_months,
      action_costs: settings.action_costs,
      low_credit_threshold: settings.low_credit_threshold,
      enforce: settings.enforce,
    },
    gateway_ready: !!gateway,
    account: account.data ?? null,
    payments: payments.data ?? [],
    ledger: ledger.data ?? [],
    usage_month: byAction,
  })
}
