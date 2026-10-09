import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { checkBillingAccount } from '@/lib/billing/account'

/** PUT /api/billing/account { doc_type, doc_number, legal_name, email } (admins) — payer data for Payment Latam. */
export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const check = checkBillingAccount(body)
  if (!check.ok) return NextResponse.json({ error: `invalid_${check.error}` }, { status: 400 })
  const { data, error } = await supabaseAdmin()
    .from('billing_accounts')
    .upsert({ workspace_id: guard.ctx.workspace.id, ...check.value }, { onConflict: 'workspace_id' })
    .select('doc_type, doc_number, legal_name, email')
    .single()
  if (error) {
    console.error('[billing] account save failed:', error.message)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  return NextResponse.json({ account: data })
}
