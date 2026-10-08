import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { activeMemberIds } from '@/lib/inbox/server'

/**
 * PATCH  /api/teams/[id] { name?, description?, member_ids? } (admins)
 *   member_ids replaces the team's members. → { team }
 * DELETE /api/teams/[id] (admins) — conversations keep working (team_id
 *   becomes null). → { ok }
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const update: Record<string, unknown> = {}
  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
    if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
    update.name = name
  }
  if ('description' in body) {
    update.description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) || null : null
  }

  let team: Record<string, unknown> | null = null
  if (Object.keys(update).length) {
    const { data, error } = await supabase
      .from('teams')
      .update(update)
      .eq('id', id)
      .eq('workspace_id', workspace.id)
      .select('id, workspace_id, name, description, created_at')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') return NextResponse.json({ error: 'name_taken' }, { status: 409 })
      console.error('[teams] update failed:', error.message)
      return NextResponse.json({ error: 'Failed to update team' }, { status: 500 })
    }
    team = data
  } else {
    const { data } = await supabase
      .from('teams')
      .select('id, workspace_id, name, description, created_at')
      .eq('id', id)
      .eq('workspace_id', workspace.id)
      .maybeSingle()
    team = data
  }
  if (!team) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (Array.isArray(body.member_ids)) {
    const wanted = body.member_ids.filter((x): x is string => typeof x === 'string' && isUuid(x))
    const memberIds = await activeMemberIds(workspace.id, wanted)
    const { data: current } = await supabase.from('team_members').select('user_id').eq('team_id', id).eq('workspace_id', workspace.id)
    const have = (current ?? []).map((m) => m.user_id as string)
    const toRemove = have.filter((u) => !memberIds.includes(u))
    const toAdd = memberIds.filter((u) => !have.includes(u))
    if (toRemove.length) {
      const { error } = await supabase.from('team_members').delete().eq('team_id', id).eq('workspace_id', workspace.id).in('user_id', toRemove)
      if (error) console.error('[teams] member removal failed:', error.message)
    }
    if (toAdd.length) {
      const { error } = await supabase
        .from('team_members')
        .insert(toAdd.map((uid) => ({ workspace_id: workspace.id, team_id: id, user_id: uid })))
      if (error) console.error('[teams] member insert failed:', error.message)
    }
  }
  const { data: links } = await supabase.from('team_members').select('user_id').eq('team_id', id).eq('workspace_id', workspace.id)
  return NextResponse.json({ team: { ...team, member_ids: (links ?? []).map((l) => l.user_id as string) } })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const { data, error } = await supabase.from('teams').delete().eq('id', id).eq('workspace_id', workspace.id).select('id')
  if (error) {
    console.error('[teams] delete failed:', error.message)
    return NextResponse.json({ error: 'Failed to delete team' }, { status: 500 })
  }
  if (!data?.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
