import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import type { TenantDb } from '@/lib/db/tenant'
import { getPlatformSetting } from '@/lib/platform/settings'
import { reportSettings } from '@/lib/reports/settings'
import { estimateNumber, monthBounds, projectMonth, ratesFor, type NumberUsage, type StoredMetaRates } from '@/lib/meta-usage/rates'
import type { Workspace } from '@/lib/workspace/types'

/**
 * Per WhatsApp number for one month: service replies vs. Meta's free tier,
 * templates by category, and the estimated Meta charge. Shared by
 * GET /api/reports/meta-usage and the PDF report. Throws on a DB error.
 */
export async function loadMetaUsage(
  workspace: Pick<Workspace, 'id' | 'country' | 'currency'> & Parameters<typeof reportSettings>[0],
  db: TenantDb,
  bounds: NonNullable<ReturnType<typeof monthBounds>>,
) {
  const [channels, usage, stored]: [
    { id: string; name: string; display_handle: string | null; status: string }[],
    (NumberUsage & { channel_id: string })[],
    StoredMetaRates | null,
  ] = await Promise.all([
    db.channels.findMany({ select: { id: true, name: true, display_handle: true, status: true }, where: { type: 'whatsapp' }, orderBy: { created_at: 'asc' } }),
    // meta_message_usage filters by `ws` itself.
    prisma
      .$queryRaw<(NumberUsage & { channel_id: string })[]>`SELECT * FROM public.meta_message_usage(${workspace.id}::uuid, ${bounds.since}::timestamptz, ${bounds.until}::timestamptz)`
      .then(normalizeRaw),
    getPlatformSetting<StoredMetaRates>('meta_rates'),
  ])

  const { rates, market, freePerNumber } = ratesFor(workspace.country, stored)
  const rows = usage
  const byChannel = new Map(rows.map((u) => [u.channel_id, u]))
  const numbers = channels.map((ch) => {
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

  return {
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
  }
}

export type MetaUsage = Awaited<ReturnType<typeof loadMetaUsage>>
