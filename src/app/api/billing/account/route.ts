import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { checkBillingAccount } from '@/lib/billing/account'

/** PUT /api/billing/account { doc_type, doc_number, legal_name, email } (admins) — payer data for Payment Latam. */
export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const check = checkBillingAccount(body)
  if (!check.ok) return NextResponse.json({ error: `invalid_${check.error}` }, { status: 400 })
  const ws = guard.ctx.workspace.id
  let data
  try {
    data = await guard.ctx.db.billing_accounts.upsert({
      where: { workspace_id: ws },
      create: { workspace_id: ws, ...check.value },
      update: check.value,
      select: { doc_type: true, doc_number: true, legal_name: true, email: true },
    })
  } catch (err) {
    console.error('[billing] account save failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  return NextResponse.json({ account: data })
}
