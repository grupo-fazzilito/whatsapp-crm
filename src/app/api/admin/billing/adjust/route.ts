import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { prisma } from '@/lib/db/prisma'
import { creditBalance, grantCredits, spendCredits } from '@/lib/billing/credits'
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
  // Platform client: the superadmin acts on any workspace by id.
  const ws = await prisma.workspaces.findUnique({ where: { id: body.workspace_id }, select: { id: true } }).catch(() => null)
  if (!ws) return NextResponse.json({ error: 'workspace not found' }, { status: 404 })

  try {
    if (credits > 0) {
      const settings = await getBillingSettings()
      const expires = new Date()
      expires.setMonth(expires.getMonth() + settings.expiry_months)
      await grantCredits({ workspaceId: ws.id, amount: credits, source: 'grant', expiresAt: expires.toISOString(), paymentId: null, note, actorId: user?.id ?? null })
    } else {
      await spendCredits({ workspaceId: ws.id, amount: -credits, action: 'adjustment', conversationId: null, partial: true, note, actorId: user?.id ?? null })
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  const balance = await creditBalance(ws.id).catch(() => 0)
  return NextResponse.json({ balance: Number(balance ?? 0) })
}
