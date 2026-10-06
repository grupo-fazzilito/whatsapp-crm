import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getWorkspaceContext, listMemberships, workspaceCookieOptions } from '@/lib/workspace/context'
import { WORKSPACE_COOKIE } from '@/lib/workspace/constants'
import { INDUSTRY_IDS } from '@/lib/industries'

// GET — active workspace + every membership (for the switcher).
export async function GET() {
  const ctx = await getWorkspaceContext()
  if (!ctx) {
    const {
      data: { user },
    } = await (await createClient(null)).auth.getUser()
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
  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = String(body.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const industry = INDUSTRY_IDS.includes(body.industry) ? body.industry : 'generic'

  const db = supabaseAdmin()
  const { data: slug } = await db.rpc('make_ws_slug', { n: name })
  const { data: ws, error } = await db
    .from('workspaces')
    .insert({
      name,
      slug,
      industry,
      country: body.country || null,
      currency: body.currency || 'USD',
      timezone: body.timezone || 'UTC',
      locale: body.locale === 'en' ? 'en' : 'es',
      created_by: user.id,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { error: memErr } = await db
    .from('workspace_members')
    .insert({ workspace_id: ws.id, user_id: user.id, role: 'owner' })
  if (memErr) {
    await db.from('workspaces').delete().eq('id', ws.id)
    return NextResponse.json({ error: memErr.message }, { status: 500 })
  }

  const res = NextResponse.json({ workspace: ws })
  res.cookies.set(WORKSPACE_COOKIE, ws.id, workspaceCookieOptions())
  return res
}
