import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { parsePostInput, postIssues, POST_STATUSES, type PostStatus } from '@/lib/social/model'
import { createPost, listPosts, loadSocialWorkspace, missingFor } from '@/lib/social/server'

/** GET /api/social/posts?from=&to=&status=a,b → { posts } */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const sp = new URL(request.url).searchParams
  const date = (v: string | null) => {
    const d = v ? new Date(v) : null
    return d && !Number.isNaN(d.getTime()) ? d : undefined
  }
  const status = (sp.get('status') ?? '').split(',').filter((s): s is PostStatus => (POST_STATUSES as readonly string[]).includes(s))
  return NextResponse.json({ posts: await listPosts(guard.ctx.workspace.id, { from: date(sp.get('from')), to: date(sp.get('to')), status }) })
}

/** POST { format, caption, media, targets, product_id?, link_url?, scheduled_at?, draft? } (admins) → { post } */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const input = parsePostInput(await request.json().catch(() => null))
  if (!input) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  // A draft can be incomplete; it's checked again when it's scheduled.
  const issues = postIssues(input).filter((i) => !input.draft || i === 'too_many_media' || i === 'caption_too_long')
  if (issues.length) return NextResponse.json({ error: 'issues', issues }, { status: 400 })
  const ws = await loadSocialWorkspace(guard.ctx.workspace.id)
  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  if (input.product_id && !(await guard.ctx.db.products.findFirst({ where: { id: input.product_id }, select: { id: true } }))) {
    return NextResponse.json({ error: 'invalid_product' }, { status: 400 })
  }
  if (!input.draft) {
    const missing = await missingFor(ws, input.targets)
    if (missing.length) return NextResponse.json({ error: 'not_connected', targets: missing }, { status: 409 })
  }
  return NextResponse.json({ post: await createPost(ws, guard.ctx.user.id, input) }, { status: 201 })
}
