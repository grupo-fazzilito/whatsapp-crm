import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { getWorkspaceContext, listMemberships, workspaceCookieOptions } from '@/lib/workspace/context'
import { WORKSPACE_COOKIE } from '@/lib/workspace/constants'
import { INDUSTRY_IDS } from '@/lib/industries'

// GET — active workspace + every membership (for the switcher).
export async function GET() {
  const ctx = await getWorkspaceContext()
  if (!ctx) {
    const user = await getSessionUser()
    return NextResponse.json(
      { error: user ? 'No workspace' : 'Unauthorized' },
      { status: user ? 404 : 401 },
    )
  }
  const memberships = await listMemberships(ctx.user.id)
  const res = NextResponse.json({
    workspace: ctx.workspace,
    role: ctx.role,
    memberships: memberships.map((m) => ({
      role: m.role,
      workspace: { id: m.workspace.id, name: m.workspace.name, industry: m.workspace.industry, logo_url: m.workspace.logo_url },
    })),
  })
  // Heal a missing/stale cookie so the browser client scopes correctly.
  res.cookies.set(WORKSPACE_COOKIE, ctx.workspace.id, workspaceCookieOptions())
  return res
}

// POST — create another workspace owned by the caller and switch to it.
export async function POST(req: NextRequest) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const industry = INDUSTRY_IDS.includes(body.industry) ? body.industry : 'generic'

  // Platform client: the workspace does not exist yet.
  let ws
  try {
    const [row] = await prisma.$queryRaw<{ slug: string }[]>`SELECT public.make_ws_slug(${name}::text) AS slug`
    ws = await prisma.workspaces.create({
      data: {
        name,
        slug: row?.slug as string,
        industry,
        country: body.country || null,
        currency: body.currency || 'USD',
        timezone: body.timezone || 'UTC',
        locale: body.locale === 'en' ? 'en' : 'es',
        created_by: user.id,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  try {
    await tenantDb(ws.id).workspace_members.create({ data: { workspace_id: ws.id, user_id: user.id, role: 'owner' } })
  } catch (err) {
    await prisma.workspaces.deleteMany({ where: { id: ws.id } }).catch(() => {})
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const res = NextResponse.json({ workspace: ws })
  res.cookies.set(WORKSPACE_COOKIE, ws.id, workspaceCookieOptions())
  return res
}
