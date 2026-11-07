import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { LlmUnavailableError } from '@/lib/ai/llm'
import { CaptionError, writeCaption } from '@/lib/social/ai'
import { isFormat, isTarget } from '@/lib/social/model'
import { loadSocialWorkspace, socialSettingsOf } from '@/lib/social/server'
import { storePath, storeSettings } from '@/lib/store/settings'
import { siteUrl } from '@/lib/real-estate/listing/url'

/** POST { format, targets, product_id?, idea? } (admins) → { caption }. Uses 1 AI token. */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const rl = checkRateLimit(`social-caption:${guard.ctx.user.id}`, { limit: 20, windowMs: 60_000 })
  if (!rl.success) return rateLimitResponse(rl)
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const format = body?.format
  const targets = Array.isArray(body?.targets) ? body.targets.filter(isTarget) : []
  const productId = typeof body?.product_id === 'string' && isUuid(body.product_id) ? body.product_id : null
  const idea = typeof body?.idea === 'string' ? body.idea.trim().slice(0, 600) : ''
  if (!isFormat(format) || (!productId && !idea)) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const ws = await loadSocialWorkspace(guard.ctx.workspace.id)
  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const product = productId
    ? await guard.ctx.db.products.findFirst({ where: { id: productId }, select: { id: true, name: true, description: true, price: true, compare_at_price: true } })
    : null
  if (productId && !product) return NextResponse.json({ error: 'invalid_product' }, { status: 400 })
  try {
    const caption = await writeCaption({
      workspace: ws,
      product: product
        ? { name: product.name, description: product.description, price: product.price == null ? null : Number(product.price), compare_at_price: product.compare_at_price == null ? null : Number(product.compare_at_price) }
        : null,
      idea,
      link: product && storeSettings(ws.settings?.store).enabled ? `${siteUrl()}${storePath(ws.slug)}/producto/${product.id}` : null,
      format,
      targets: targets.length ? targets : ['facebook', 'instagram'],
      instructions: socialSettingsOf(ws).caption_instructions,
    })
    return NextResponse.json({ caption })
  } catch (err) {
    if (err instanceof CaptionError) return NextResponse.json({ error: err.code }, { status: err.code === 'no_credits' ? 402 : 502 })
    if (err instanceof LlmUnavailableError) return NextResponse.json({ error: 'no_provider' }, { status: 503 })
    console.error('[social] caption failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 502 })
  }
}
