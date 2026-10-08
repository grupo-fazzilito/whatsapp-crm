import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { parseInboxSettings } from '@/lib/inbox/assignment'
import { activeMemberIds } from '@/lib/inbox/server'

/**
 * GET /api/teams → {
 *   teams: [{id, name, description, member_ids}],
 *   members: [{user_id, role, available, full_name, email, avatar_url}],
 *   settings: {auto_assign, default_team_id},
 *   me: {user_id, available}
 * }
 * POST /api/teams { name, description?, member_ids? } (admins) → { team }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, user, workspace } = guard.ctx

  const [teamsRes, linksRes, membersRes] = await Promise.all([
    supabase.from('teams').select('id, workspace_id, name, description, created_at').eq('workspace_id', workspace.id).order('name'),
    supabase.from('team_members').select('team_id, user_id').eq('workspace_id', workspace.id),
    supabase
      .from('workspace_members')
      .select('user_id, role, available, last_assigned_at')
      .eq('workspace_id', workspace.id)
      .eq('status', 'active'),
  ])
  if (teamsRes.error || membersRes.error) {
    console.error('[teams] list failed:', teamsRes.error?.message ?? membersRes.error?.message)
    return NextResponse.json({ error: 'Failed to load teams' }, { status: 500 })
  }
  const ids = (membersRes.data ?? []).map((m) => m.user_id as string)
  const { data: profiles } = ids.length
    ? await supabase.from('profiles').select('user_id, full_name, email, avatar_url').in('user_id', ids)
    : { data: [] }
  const byId = new Map((profiles ?? []).map((p) => [p.user_id as string, p]))

  const links = linksRes.data ?? []
  const teams = (teamsRes.data ?? []).map((t) => ({
    ...t,
    member_ids: links.filter((l) => l.team_id === t.id).map((l) => l.user_id as string),
  }))
  const members = (membersRes.data ?? [])
    .map((m) => {
      const p = byId.get(m.user_id as string)
      return {
        user_id: m.user_id,
        role: m.role,
        available: m.available !== false,
        full_name: (p?.full_name as string) ?? '',
        email: (p?.email as string) ?? '',
        avatar_url: (p?.avatar_url as string | null) ?? null,
      }
    })
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email))
  const mine = members.find((m) => m.user_id === user.id)

  return NextResponse.json({
    teams,
    members,
    settings: parseInboxSettings(workspace.settings),
    me: { user_id: user.id, available: mine?.available ?? true },
  })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : ''
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 300) || null : null

  const { data: team, error } = await supabase
    .from('teams')
    .insert({ workspace_id: workspace.id, name, description })
    .select('id, workspace_id, name, description, created_at')
    .single()
  if (error || !team) {
    if (error?.code === '23505') return NextResponse.json({ error: 'name_taken' }, { status: 409 })
    console.error('[teams] create failed:', error?.message)
    return NextResponse.json({ error: 'Failed to create team' }, { status: 500 })
  }

  const wanted = Array.isArray(body?.member_ids) ? body!.member_ids.filter((x): x is string => typeof x === 'string' && isUuid(x)) : []
  const memberIds = await activeMemberIds(workspace.id, wanted)
  if (memberIds.length) {
    const { error: mErr } = await supabase
      .from('team_members')
      .insert(memberIds.map((uid) => ({ workspace_id: workspace.id, team_id: team.id, user_id: uid })))
    if (mErr) console.error('[teams] members insert failed:', mErr.message)
  }
  return NextResponse.json({ team: { ...team, member_ids: memberIds } })
}
