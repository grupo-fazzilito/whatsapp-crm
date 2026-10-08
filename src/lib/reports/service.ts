import 'server-only'
// Server side of /api/reports: runs the reports_* RPCs (migration 034)
// with the service role — every call carries the workspace id — and
// loads resolution closures, then hands everything to assembleReport.

import type { SupabaseClient } from '@supabase/supabase-js'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveIndustry } from '@/lib/industries'
import type { Workspace } from '@/lib/workspace/types'
import {
  STREAM_LOOKAHEAD_MS,
  STREAM_LOOKBACK_MS,
  assembleReport,
  type BusinessDoc,
  type SnapshotDoc,
  type StreamDoc,
  type VolumeDoc,
} from './assemble'
import type { ReportRange } from './range'
import { reportSettings } from './settings'
import type { Closure } from './sessions'
import type { ChannelRef, NamedRef, ReportPayload, ReportScope, ResolutionBasis } from './types'

export const STREAM_LIMIT = 100_000
const PAGE = 1000
const MAX_PAGES = 50

export interface ReportRequest {
  workspace: Workspace
  userId: string
  scope: ReportScope
  range: ReportRange
  channelId: string | null
  agentId: string | null
  teamId: string | null
  now?: Date
}

export type ReportResult = { ok: true; report: ReportPayload } | { ok: false; error: 'invalid_filter' }

/** Missing table / column (feature migration not applied) → treat as absent. */
function isMissing(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return ['42P01', '42703', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code ?? '') || /does not exist|could not find/i.test(error.message ?? '')
}

async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return data as T
}

async function loadOptions(db: SupabaseClient, wsId: string) {
  const [channels, members, aiAgents, teams] = await Promise.all([
    db.from('channels').select('id, name, type, purpose').eq('workspace_id', wsId).order('created_at'),
    db.from('workspace_members').select('user_id, status').eq('workspace_id', wsId),
    db.from('ai_agents').select('id, name').eq('workspace_id', wsId).order('created_at'),
    db.from('teams').select('id, name').eq('workspace_id', wsId).order('name'),
  ])
  if (channels.error) throw channels.error
  if (members.error) throw members.error
  if (aiAgents.error) throw aiAgents.error
  if (teams.error && !isMissing(teams.error)) throw teams.error
  const userIds = (members.data ?? []).map((m) => m.user_id as string)
  const profiles = userIds.length
    ? await db.from('profiles').select('user_id, full_name, email').in('user_id', userIds)
    : { data: [], error: null }
  if (profiles.error) throw profiles.error
  const nameOf = new Map((profiles.data ?? []).map((p) => [p.user_id as string, (p.full_name as string | null)?.trim() || (p.email as string) || '']))
  const agents: NamedRef[] = userIds.map((id) => ({ id, name: nameOf.get(id) ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
  return {
    channels: (channels.data ?? []) as ChannelRef[],
    agents,
    aiAgents: (aiAgents.data ?? []) as NamedRef[],
    teams: teams.error ? null : ((teams.data ?? []) as NamedRef[]),
  }
}

async function paged<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>) {
  const rows: T[] = []
  for (let p = 0; p < MAX_PAGES; p++) {
    const { data, error } = await build(p * PAGE, p * PAGE + PAGE - 1)
    if (error) return { rows, error }
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return { rows, error: null }
}

/**
 * Resolve instants in [from, to): conversation_events 'resolved' (with who
 * resolved), supplemented by conversations.resolved_at for conversations
 * without an event at that time (history from before events existed).
 * Without either, falls back to status = closed at updated_at.
 */
async function loadClosures(db: SupabaseClient, wsId: string, from: Date, to: Date): Promise<{ closures: Closure[]; basis: ResolutionBasis }> {
  const f = from.toISOString()
  const t = to.toISOString()
  const ev = await paged<{ conversation_id: string; created_at: string; from_user: string | null }>((a, b) =>
    db.from('conversation_events').select('conversation_id, created_at, from_user').eq('workspace_id', wsId).eq('type', 'resolved')
      .gte('created_at', f).lt('created_at', t).order('created_at').range(a, b),
  )
  const hasEvents = !ev.error
  if (ev.error && !isMissing(ev.error)) throw new Error(ev.error.message)
  const closures: Closure[] = ev.rows.map((e) => ({ conversationId: e.conversation_id, at: Date.parse(e.created_at), by: e.from_user }))

  const rs = await paged<{ id: string; resolved_at: string; resolved_by: string | null }>((a, b) =>
    db.from('conversations').select('id, resolved_at, resolved_by').eq('workspace_id', wsId)
      .gte('resolved_at', f).lt('resolved_at', t).order('resolved_at').range(a, b),
  )
  if (!rs.error) {
    const known = new Map<string, number[]>()
    for (const c of closures) known.set(c.conversationId, [...(known.get(c.conversationId) ?? []), c.at])
    let added = 0
    for (const r of rs.rows) {
      const at = Date.parse(r.resolved_at)
      if ((known.get(r.id) ?? []).some((x) => Math.abs(x - at) < 60_000)) continue
      closures.push({ conversationId: r.id, at, by: r.resolved_by })
      added++
    }
    const basis: ResolutionBasis = hasEvents ? (added > 0 ? 'mixed' : 'events') : 'resolved_at'
    return { closures, basis }
  }
  if (!isMissing(rs.error)) throw new Error(rs.error.message)
  if (hasEvents) return { closures, basis: 'events' }

  const cl = await paged<{ id: string; updated_at: string; assigned_agent_id: string | null }>((a, b) =>
    db.from('conversations').select('id, updated_at, assigned_agent_id').eq('workspace_id', wsId).eq('status', 'closed')
      .gte('updated_at', f).lt('updated_at', t).order('updated_at').range(a, b),
  )
  if (cl.error) throw new Error(cl.error.message)
  return {
    closures: cl.rows.map((r) => ({ conversationId: r.id, at: Date.parse(r.updated_at), by: r.assigned_agent_id })),
    basis: 'closed_status',
  }
}

export async function buildReport(req: ReportRequest): Promise<ReportResult> {
  const db = supabaseAdmin()
  const ws = req.workspace
  const now = req.now ?? new Date()
  const personal = req.scope === 'personal'
  const options = await loadOptions(db, ws.id)

  const agentId = personal ? req.userId : req.agentId
  const teamId = personal ? null : req.teamId
  if (req.channelId && !options.channels.some((c) => c.id === req.channelId)) return { ok: false, error: 'invalid_filter' }
  if (agentId && !options.agents.some((a) => a.id === agentId)) return { ok: false, error: 'invalid_filter' }
  if (teamId && !options.teams?.some((t) => t.id === teamId)) return { ok: false, error: 'invalid_filter' }

  const filterArgs = {
    p_ws: ws.id,
    p_channels: req.channelId ? [req.channelId] : null,
    p_agents: agentId ? [agentId] : null,
    p_team: teamId,
  }
  const from = req.range.from
  const to = req.range.to
  const streamFrom = new Date(from.getTime() - STREAM_LOOKBACK_MS)
  const streamTo = new Date(Math.min(to.getTime() + STREAM_LOOKAHEAD_MS, now.getTime() + 1000))
  const settings = reportSettings(ws)
  const { modules } = resolveIndustry(ws.industry, ws.settings)

  const [volume, stream, snapshot, business, closureData] = await Promise.all([
    rpc<VolumeDoc>(db, 'reports_volume', { ...filterArgs, p_from: from.toISOString(), p_to: to.toISOString(), p_tz: req.range.timeZone }),
    rpc<StreamDoc>(db, 'reports_stream', { ...filterArgs, p_from: streamFrom.toISOString(), p_to: streamTo.toISOString(), p_limit: STREAM_LIMIT }),
    rpc<SnapshotDoc>(db, 'reports_snapshot', filterArgs),
    personal ? Promise.resolve(null) : rpc<BusinessDoc>(db, 'reports_business', { ...filterArgs, p_from: from.toISOString(), p_to: to.toISOString() }),
    loadClosures(db, ws.id, streamFrom, streamTo),
  ])

  // With a filter, only closures of conversations in the filtered stream count.
  let closures = closureData.closures
  if (filterArgs.p_channels || filterArgs.p_agents || filterArgs.p_team) {
    const convs = new Set(stream.rows.map((r) => r[0]))
    closures = closures.filter((c) => convs.has(c.conversationId))
  }

  const report = assembleReport({
    scope: req.scope,
    userId: req.userId,
    range: req.range,
    settings,
    workspace: { currency: ws.currency, locale: ws.locale, country: ws.country },
    filters: { channelId: req.channelId, agentId, teamId },
    options: {
      channels: options.channels,
      agents: personal ? options.agents.filter((a) => a.id === req.userId) : options.agents,
      teams: personal ? null : options.teams,
      aiAgents: options.aiAgents,
    },
    modules: { orders: !!modules.orders, bookings: !!modules.bookings },
    volume,
    stream,
    snapshot,
    business,
    closures,
    basis: closureData.basis,
    now,
  })
  return { ok: true, report }
}

/** Merges {sla_minutes, usd_rate} into workspaces.settings.reports. */
export async function saveReportSettings(workspaceId: string, patch: { sla_minutes?: number; usd_rate?: number | null }) {
  const db = supabaseAdmin()
  const { data, error } = await db.from('workspaces').select('settings').eq('id', workspaceId).single()
  if (error) throw error
  const settings = (data?.settings ?? {}) as Record<string, unknown>
  const reports = { ...((settings.reports ?? {}) as Record<string, unknown>) }
  if (patch.sla_minutes !== undefined) reports.sla_minutes = patch.sla_minutes
  if (patch.usd_rate !== undefined) {
    if (patch.usd_rate === null) delete reports.usd_rate
    else reports.usd_rate = patch.usd_rate
  }
  const { error: upErr } = await db.from('workspaces').update({ settings: { ...settings, reports } }).eq('id', workspaceId)
  if (upErr) throw upErr
  return reports
}
