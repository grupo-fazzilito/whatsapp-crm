import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getBillingSettings } from '@/lib/billing/settings'

/**
 * POST /api/admin/billing/adjust { workspace_id, credits, note }
 * credits > 0 → gift/compensation lot (normal expiry); credits < 0 → deduction.
 */
export async function POST(req: Request) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as { workspace_id?: string; credits?: unknown; note?: unknown } | null
  const credits = Number(body?.credits)
  const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : ''
  if (!body?.workspace_id || !Number.isInteger(credits) || credits === 0 || Math.abs(credits) > 1_000_000) {
    return NextResponse.json({ error: 'workspace_id and a non-zero whole number of credits are required' }, { status: 400 })
  }
  if (!note) return NextResponse.json({ error: 'note is required' }, { status: 400 })
  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  const db = supabaseAdmin()
  const { data: ws } = await db.from('workspaces').select('id').eq('id', body.workspace_id).maybeSingle()
  if (!ws) return NextResponse.json({ error: 'workspace not found' }, { status: 404 })

  if (credits > 0) {
    const settings = await getBillingSettings()
    const expires = new Date()
    expires.setMonth(expires.getMonth() + settings.expiry_months)
    const { error } = await db.rpc('grant_credits', { ws: ws.id, amount: credits, src: 'grant', expires: expires.toISOString(), pay: null, why: note, actor: user?.id ?? null })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await db.rpc('spend_credits', { ws: ws.id, amount: -credits, act: 'adjustment', conv: null, partial: true, why: note, actor: user?.id ?? null })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  const { data: balance } = await db.rpc('credit_balance', { ws: ws.id })
  return NextResponse.json({ balance: Number(balance ?? 0) })
}
