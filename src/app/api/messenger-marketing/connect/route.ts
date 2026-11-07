import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { saveConnection } from '@/lib/messenger-marketing/server'
import { unseal } from '@/app/api/channels/_lib/shared'
import { MM_COOKIE, MM_COOKIE_PATH, type MarketingCandidates } from '../shared'

function read(request: NextRequest, ws: string, uid: string): MarketingCandidates | null {
  const d = unseal<MarketingCandidates>(request.cookies.get(MM_COOKIE)?.value)
  return d && d.exp > Date.now() && d.ws === ws && d.uid === uid ? d : null
}

/** GET → { pages, ad_accounts } offered after Facebook Login (no token). */
export async function GET(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const d = read(request, guard.ctx.workspace.id, guard.ctx.user.id)
  return NextResponse.json({ pages: d?.pages ?? [], ad_accounts: d?.adAccounts ?? [] })
}

/** POST { page_id, ad_account_id } → connects them. */
export async function POST(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user, db } = guard.ctx
  const d = read(request, workspace.id, user.id)
  const body = (await request.json().catch(() => null)) as { page_id?: unknown; ad_account_id?: unknown } | null
  const page = d?.pages.find((p) => p.id === body?.page_id)
  const ad = d?.adAccounts.find((a) => a.id === body?.ad_account_id)
  if (!d || !page || !ad) return NextResponse.json({ error: 'expired' }, { status: 410 })
  const channel = await db.channels.findFirst({ where: { type: 'messenger', external_id: page.id }, select: { id: true } })
  if (!channel) return NextResponse.json({ error: 'no_page' }, { status: 400 })
  await saveConnection(workspace.id, user.id, { channelId: channel.id, pageId: page.id, adAccount: ad, token: d.token })
  const res = NextResponse.json({ ok: true })
  res.cookies.set(MM_COOKIE, '', { path: MM_COOKIE_PATH, maxAge: 0 })
  return res
}
