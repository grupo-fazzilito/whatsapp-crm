import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getPlatformSetting } from '@/lib/platform/settings'
import { reportSettings } from '@/lib/reports/settings'
import { estimateNumber, monthBounds, projectMonth, ratesFor, type NumberUsage, type StoredMetaRates } from '@/lib/meta-usage/rates'

/**
 * GET /api/reports/meta-usage?month=YYYY-MM (admins)
 * Per WhatsApp number: service replies vs. Meta's 1,000 free per month,
 * templates by category, and the estimated Meta charge (USD + workspace
 * currency). Meta bills the business directly; this is an estimate.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace } = guard.ctx
  const bounds = monthBounds(new URL(request.url).searchParams.get('month'))
  if (!bounds) return NextResponse.json({ error: 'invalid_month' }, { status: 400 })

  const db = supabaseAdmin()
  const [channels, usage, stored] = await Promise.all([
    db.from('channels').select('id, name, display_handle, status').eq('workspace_id', workspace.id).eq('type', 'whatsapp').order('created_at'),
    db.rpc('meta_message_usage', { ws: workspace.id, since: bounds.since.toISOString(), until: bounds.until.toISOString() }),
    getPlatformSetting<StoredMetaRates>('meta_rates'),
  ])
  if (channels.error || usage.error) {
    console.error('[meta-usage] failed:', channels.error?.message ?? usage.error?.message)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }

  const { rates, market, freePerNumber } = ratesFor(workspace.country, stored)
  const rows = (usage.data ?? []) as (NumberUsage & { channel_id: string })[]
  const byChannel = new Map(rows.map((u) => [u.channel_id, u]))
  const numbers = (channels.data ?? []).map((ch) => {
    const raw = byChannel.get(ch.id)
    const u: NumberUsage = {
      service: Number(raw?.service ?? 0),
      marketing: Number(raw?.marketing ?? 0),
      utility: Number(raw?.utility ?? 0),
      authentication: Number(raw?.authentication ?? 0),
      other_template: Number(raw?.other_template ?? 0),
    }
    const projectedService = projectMonth(u.service, bounds.since, bounds.until)
    return {
      channelId: ch.id,
      name: ch.name,
      phone: ch.display_handle,
      status: ch.status,
      usage: u,
      estimate: estimateNumber(u, rates, freePerNumber),
      projectedService,
      projectedOverFree: projectedService > freePerNumber,
    }
  })
  const totalUsd = Math.round(numbers.reduce((a, n) => a + n.estimate.costUsd.total, 0) * 10_000) / 10_000
  const { usdRate } = reportSettings(workspace)

  return NextResponse.json({
    month: bounds.month,
    current: bounds.month === monthBounds(null)!.month,
    market,
    rates,
    freePerNumber,
    currency: workspace.currency,
    usdRate,
    numbers,
    totals: {
      service: numbers.reduce((a, n) => a + n.usage.service, 0),
      templates: numbers.reduce((a, n) => a + n.usage.marketing + n.usage.utility + n.usage.authentication + n.usage.other_template, 0),
      costUsd: totalUsd,
      costLocal: usdRate ? Math.round(totalUsd * usdRate * 100) / 100 : null,
    },
  })
}
