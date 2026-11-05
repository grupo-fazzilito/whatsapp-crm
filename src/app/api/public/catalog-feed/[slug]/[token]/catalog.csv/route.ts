import crypto from 'node:crypto'
import { findWorkspaceBySlug } from '@/lib/workspace/slug-server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { storeSettings } from '@/lib/store/settings'
import { visitorIp } from '@/lib/store/request'
import { feedCsv } from '@/lib/meta-catalog/items'
import { allCatalogItems } from '@/lib/meta-catalog/sync'
import type { WorkspaceSettings } from '@/lib/workspace/types'

type Ctx = { params: Promise<{ slug: string; token: string }> }

export const dynamic = 'force-dynamic'

const same = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))

/**
 * GET /api/public/catalog-feed/:slug/:token/catalog.csv — the business's
 * products as a Meta product feed (Commerce Manager → Data sources →
 * Scheduled feed). Built on every read; the token is the only secret.
 */
export async function GET(request: Request, { params }: Ctx) {
  const { slug, token } = await params
  const limit = checkRateLimit(`catalog-feed:${visitorIp(request)}`, { limit: 30, windowMs: 10 * 60_000 })
  if (!limit.success) return rateLimitResponse(limit)
  const ws = await findWorkspaceBySlug(slug, { id: true, name: true, slug: true, currency: true, settings: true }).catch(() => null)
  const expected = ws ? storeSettings((ws.settings as WorkspaceSettings | null)?.store).feed_token : null
  if (!ws || !expected || !same(token, expected)) return new Response('Not found', { status: 404 })
  const items = await allCatalogItems(ws)
  return new Response(feedCsv(items), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
