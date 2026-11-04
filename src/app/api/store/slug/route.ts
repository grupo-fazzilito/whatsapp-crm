import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { normalizeSlug, slugProblem } from '@/lib/workspace/slug'
import { changeWorkspaceSlug, slugAvailable } from '@/lib/workspace/slug-server'
import { storePath } from '@/lib/store/settings'
import { siteUrl } from '@/lib/real-estate/listing/url'

/**
 * The business's public address (/tienda/<slug>, also used by property pages).
 * GET  ?slug=<text>  → { slug (normalized), problem, available } — without ?slug:
 *                      { current, suggestion, suggestion_available } (suggestion from the name)
 * PUT  (admin) { slug } → { slug, url } | 400 { error: short|long|format|reserved } | 409 { error: taken }
 * Old addresses keep working and redirect to the new one.
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace } = guard.ctx
  const raw = new URL(request.url).searchParams.get('slug')
  if (raw === null) {
    const suggestion = normalizeSlug(workspace.name)
    const ok = !slugProblem(suggestion) && (suggestion === workspace.slug || (await slugAvailable(suggestion, workspace.id)))
    return NextResponse.json({ current: workspace.slug, suggestion, suggestion_available: ok })
  }
  const slug = normalizeSlug(raw)
  const problem = slugProblem(slug)
  return NextResponse.json({ slug, problem, available: !problem && (await slugAvailable(slug, workspace.id)) })
}

export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as { slug?: unknown } | null
  if (typeof body?.slug !== 'string') return NextResponse.json({ error: 'format' }, { status: 400 })
  // Only normalized input is accepted, so what was checked is what is saved.
  const slug = body.slug.trim()
  if (normalizeSlug(slug) !== slug) return NextResponse.json({ error: 'format' }, { status: 400 })
  const r = await changeWorkspaceSlug(guard.ctx.workspace.id, slug)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.error === 'taken' ? 409 : 400 })
  return NextResponse.json({ slug: r.slug, url: siteUrl() + storePath(r.slug) })
}
