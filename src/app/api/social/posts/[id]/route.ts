import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parsePostInput, postIssues } from '@/lib/social/model'
import { deletePost, getPost, loadSocialWorkspace, missingFor, postAction, updatePost } from '@/lib/social/server'

type Ctx = { params: Promise<{ id: string }> }
const notFound = () => NextResponse.json({ error: 'not_found' }, { status: 404 })

export async function GET(_request: Request, ctx: Ctx) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  const post = isUuid(id) ? await getPost(guard.ctx.workspace.id, id) : null
  return post ? NextResponse.json({ post }) : notFound()
}

/** PATCH { ...post } (admins): edits a post that hasn't gone out. */
export async function PATCH(request: Request, ctx: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return notFound()
  const input = parsePostInput(await request.json().catch(() => null))
  if (!input) return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const issues = postIssues(input).filter((i) => !input.draft || i === 'too_many_media' || i === 'caption_too_long')
  if (issues.length) return NextResponse.json({ error: 'issues', issues }, { status: 400 })
  const ws = await loadSocialWorkspace(guard.ctx.workspace.id)
  if (!ws) return notFound()
  if (!input.draft) {
    const missing = await missingFor(ws, input.targets)
    if (missing.length) return NextResponse.json({ error: 'not_connected', targets: missing }, { status: 409 })
  }
  const res = await updatePost(ws, guard.ctx.user.id, id, input)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.error === 'not_found' ? 404 : 409 })
  return NextResponse.json({ post: res.post })
}

/** POST { action: approve | publish_now | retry | cancel } (admins) */
export async function POST(request: Request, ctx: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return notFound()
  const body = (await request.json().catch(() => null)) as { action?: unknown } | null
  const action = body?.action
  if (action !== 'approve' && action !== 'publish_now' && action !== 'retry' && action !== 'cancel') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const ws = await loadSocialWorkspace(guard.ctx.workspace.id)
  if (!ws) return notFound()
  if (action !== 'cancel') {
    const post = await getPost(ws.id, id)
    if (!post) return notFound()
    const issues = postIssues({ ...post, scheduled_at: null, draft: false })
    if (issues.length) return NextResponse.json({ error: 'issues', issues }, { status: 400 })
    const missing = await missingFor(ws, post.targets)
    if (missing.length) return NextResponse.json({ error: 'not_connected', targets: missing }, { status: 409 })
  }
  const res = await postAction(ws, guard.ctx.user.id, id, action)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.error === 'not_found' ? 404 : 409 })
  return NextResponse.json({ post: res.post })
}

export async function DELETE(_request: Request, ctx: Ctx) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await ctx.params
  if (!isUuid(id)) return notFound()
  return (await deletePost(guard.ctx.workspace.id, id)) ? NextResponse.json({ ok: true }) : NextResponse.json({ error: 'not_deletable' }, { status: 409 })
}
