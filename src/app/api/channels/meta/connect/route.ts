import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { ChannelRow } from '@/lib/channels/types'
import {
  CONFLICT_MESSAGE,
  META_COOKIE_PATH,
  assertAgentInWorkspace,
  bad,
  candidateCookieNames,
  readCandidates,
  str,
  subscribePage,
} from '../../_lib/shared'
import { insertChannel } from '../../_lib/create'

/**
 * GET  /api/channels/meta/connect — admin. Pages / Instagram accounts the
 *      user authorized in the last Meta login (no tokens), each flagged
 *      when it's already connected.
 * POST /api/channels/meta/connect {pageIds[], instagramIds[], purpose?, ai_agent_id?}
 *      → creates messenger channels (external_id = page id) and instagram
 *      channels (external_id = IG account id, settings.page_id) with the
 *      page token as secret, and subscribes each page to our webhooks.
 * DELETE — forget the candidates (cancel).
 */

async function connectedSet(workspaceId: string, pageIds: string[], igIds: string[]) {
  const db = supabaseAdmin()
  const [pages, igs] = await Promise.all([
    pageIds.length
      ? db.from('channels').select('external_id, workspace_id').eq('type', 'messenger').in('external_id', pageIds)
      : Promise.resolve({ data: [] as { external_id: string; workspace_id: string }[] }),
    igIds.length
      ? db.from('channels').select('external_id, workspace_id').eq('type', 'instagram').in('external_id', igIds)
      : Promise.resolve({ data: [] as { external_id: string; workspace_id: string }[] }),
  ])
  const state = (rows: { external_id: string; workspace_id: string }[] | null) =>
    new Map((rows ?? []).map((r) => [r.external_id, r.workspace_id === workspaceId ? 'here' : 'elsewhere'] as const))
  return { pages: state(pages.data), igs: state(igs.data) }
}

export async function GET(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx

  const data = readCandidates((n) => request.cookies.get(n)?.value)
  if (!data || data.ws !== workspace.id || data.uid !== user.id) {
    return NextResponse.json({ pages: [] })
  }

  const conn = await connectedSet(
    workspace.id,
    data.pages.map((p) => p.id),
    data.pages.flatMap((p) => (p.ig ? [p.ig.id] : [])),
  )
  return NextResponse.json({
    pages: data.pages.map((p) => ({
      id: p.id,
      name: p.name,
      connected: conn.pages.get(p.id) ?? null,
      instagram: p.ig
        ? { id: p.ig.id, username: p.ig.username, connected: conn.igs.get(p.ig.id) ?? null }
        : null,
    })),
  })
}

export async function POST(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx

  const data = readCandidates((n) => request.cookies.get(n)?.value)
  if (!data || data.ws !== workspace.id || data.uid !== user.id) {
    return bad('Your Facebook session expired. Connect again.', 410)
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const pageIds = Array.isArray(body?.pageIds) ? (body!.pageIds as unknown[]).filter((x): x is string => typeof x === 'string') : []
  const igIds = Array.isArray(body?.instagramIds)
    ? (body!.instagramIds as unknown[]).filter((x): x is string => typeof x === 'string')
    : []
  if (pageIds.length === 0 && igIds.length === 0) return bad('Select at least one page or Instagram account')

  const purpose = str(body?.purpose, 80)
  const aiAgentId = str(body?.ai_agent_id, 64)
  if (aiAgentId && !(await assertAgentInWorkspace(workspace.id, aiAgentId))) {
    return bad('ai_agent_id does not belong to this workspace')
  }

  const created: ChannelRow[] = []
  const errors: { id: string; type: 'messenger' | 'instagram'; error: string }[] = []
  const subscribed = new Map<string, string | null>()
  const subscribe = async (pageId: string, token: string) => {
    if (!subscribed.has(pageId)) subscribed.set(pageId, await subscribePage(pageId, token))
    return subscribed.get(pageId) ?? null
  }

  for (const page of data.pages) {
    const wantPage = pageIds.includes(page.id)
    const wantIg = !!page.ig && igIds.includes(page.ig.id)
    if (!wantPage && !wantIg) continue

    const subErr = await subscribe(page.id, page.token)
    const statusDetail = subErr ? `Webhook subscription failed: ${subErr}` : null

    if (wantPage) {
      const r = await insertChannel({
        workspaceId: workspace.id,
        userId: user.id,
        type: 'messenger',
        name: page.name.slice(0, 80),
        purpose,
        aiAgentId,
        externalId: page.id,
        displayHandle: page.name,
        statusDetail,
        settings: { page_id: page.id, page_name: page.name, connected_via: 'oauth' },
        secrets: { access_token: page.token },
      })
      if (r.ok) created.push(r.channel)
      else errors.push({ id: page.id, type: 'messenger', error: r.conflict ? CONFLICT_MESSAGE : r.error })
    }

    if (wantIg && page.ig) {
      const handle = page.ig.username ? `@${page.ig.username}` : null
      const r = await insertChannel({
        workspaceId: workspace.id,
        userId: user.id,
        type: 'instagram',
        name: (handle ?? `${page.name} · Instagram`).slice(0, 80),
        purpose,
        aiAgentId,
        externalId: page.ig.id,
        displayHandle: handle,
        statusDetail,
        settings: { page_id: page.id, page_name: page.name, username: page.ig.username, connected_via: 'oauth' },
        secrets: { access_token: page.token },
      })
      if (r.ok) created.push(r.channel)
      else errors.push({ id: page.ig.id, type: 'instagram', error: r.conflict ? CONFLICT_MESSAGE : r.error })
    }
  }

  const status = created.length > 0 ? 201 : errors.some((e) => e.error === CONFLICT_MESSAGE) ? 409 : 400
  const response = NextResponse.json({ created, errors }, { status })
  if (created.length > 0) clearCookies(response)
  return response
}

export async function DELETE() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const response = NextResponse.json({ ok: true })
  clearCookies(response)
  return response
}

function clearCookies(response: NextResponse) {
  for (const name of candidateCookieNames()) {
    response.cookies.set(name, '', { path: META_COOKIE_PATH, maxAge: 0, httpOnly: true })
  }
}
