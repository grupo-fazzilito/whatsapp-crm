import 'server-only'
// Server side of /api/reports: runs the reports_* SQL functions (migration
// 034) through raw SQL — every call carries the workspace id — and loads
// resolution closures (tenant client), then hands everything to assembleReport.

import { prisma } from '@/lib/db/prisma'
import { tenantDb, type TenantDb } from '@/lib/db/tenant'
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

interface FilterArgs {
  p_ws: string
  p_channels: string[] | null
  p_agents: string[] | null
  p_team: string | null
}

/** One reports_* call; the jsonb result comes back parsed (no dates or decimals in it). */
async function rpc<T>(fn: string, query: PromiseLike<{ r: unknown }[]>): Promise<T> {
  try {
    const rows = await query
    return (rows[0]?.r ?? null) as T
  } catch (err) {
    throw new Error(`${fn}: ${err instanceof Error ? err.message : String(err)}`)
  }
}

function reportsVolume(f: FilterArgs, from: Date, to: Date, tz: string) {
  return rpc<VolumeDoc>('reports_volume', prisma.$queryRaw<{ r: unknown }[]>`
    SELECT public.reports_volume(${f.p_ws}::uuid, ${from}::timestamptz, ${to}::timestamptz, ${tz}::text, ${f.p_channels}::uuid[], ${f.p_agents}::uuid[], ${f.p_team}::uuid) AS r`)
}

function reportsStream(f: FilterArgs, from: Date, to: Date, limit: number) {
  return rpc<StreamDoc>('reports_stream', prisma.$queryRaw<{ r: unknown }[]>`
    SELECT public.reports_stream(${f.p_ws}::uuid, ${from}::timestamptz, ${to}::timestamptz, ${f.p_channels}::uuid[], ${f.p_agents}::uuid[], ${f.p_team}::uuid, ${limit}::int) AS r`)
}

function reportsSnapshot(f: FilterArgs) {
  return rpc<SnapshotDoc>('reports_snapshot', prisma.$queryRaw<{ r: unknown }[]>`
    SELECT public.reports_snapshot(${f.p_ws}::uuid, ${f.p_channels}::uuid[], ${f.p_agents}::uuid[], ${f.p_team}::uuid) AS r`)
}

function reportsBusiness(f: FilterArgs, from: Date, to: Date) {
  return rpc<BusinessDoc>('reports_business', prisma.$queryRaw<{ r: unknown }[]>`
    SELECT public.reports_business(${f.p_ws}::uuid, ${from}::timestamptz, ${to}::timestamptz, ${f.p_channels}::uuid[], ${f.p_agents}::uuid[], ${f.p_team}::uuid) AS r`)
}

async function loadOptions(db: TenantDb) {
  const [channels, members, aiAgents, teams] = await Promise.all([
    db.channels.findMany({ select: { id: true, name: true, type: true, purpose: true }, orderBy: { created_at: 'asc' } }),
    db.workspace_members.findMany({ select: { user_id: true, status: true } }),
    db.ai_agents.findMany({ select: { id: true, name: true }, orderBy: { created_at: 'asc' } }),
    db.teams.findMany({ select: { id: true, name: true }, orderBy: { name: 'asc' } }),
  ])
  const userIds = members.map((m) => m.user_id)
  // profiles has no workspace: limited to this workspace's members.
  const profiles = userIds.length
    ? await prisma.profiles.findMany({ select: { user_id: true, full_name: true, email: true }, where: { user_id: { in: userIds } } })
    : []
  const nameOf = new Map(profiles.map((p) => [p.user_id, p.full_name?.trim() || p.email || '']))
  const agents: NamedRef[] = userIds.map((id) => ({ id, name: nameOf.get(id) ?? '' })).sort((a, b) => a.name.localeCompare(b.name))
  return {
    channels: channels as ChannelRef[],
    agents,
    aiAgents: aiAgents as NamedRef[],
    teams: teams as NamedRef[] | null,
  }
}

async function paged<T>(build: (skip: number, take: number) => PromiseLike<T[]>) {
  const rows: T[] = []
  for (let p = 0; p < MAX_PAGES; p++) {
    const data = await build(p * PAGE, PAGE)
    rows.push(...data)
    if (data.length < PAGE) break
  }
  return rows
}

/**
 * Resolve instants in [from, to): conversation_events 'resolved' (with who
 * resolved), supplemented by conversations.resolved_at for conversations
 * without an event at that time (history from before events existed).
 * (Both exist in the Postgres schema, so the old status = closed fallback
 * for databases without them is gone.)
 */
async function loadClosures(db: TenantDb, from: Date, to: Date): Promise<{ closures: Closure[]; basis: ResolutionBasis }> {
  const ev = await paged((skip, take) =>
    db.conversation_events.findMany({
      select: { conversation_id: true, created_at: true, from_user: true },
      where: { type: 'resolved', created_at: { gte: from, lt: to } },
      orderBy: { created_at: 'asc' },
      skip,
      take,
    }),
  )
  const closures: Closure[] = ev.map((e) => ({ conversationId: e.conversation_id, at: Date.parse(e.created_at as string), by: e.from_user }))

  const rs = await paged((skip, take) =>
    db.conversations.findMany({
      select: { id: true, resolved_at: true, resolved_by: true },
      where: { resolved_at: { gte: from, lt: to } },
      orderBy: { resolved_at: 'asc' },
      skip,
      take,
    }),
  )
  const known = new Map<string, number[]>()
  for (const c of closures) known.set(c.conversationId, [...(known.get(c.conversationId) ?? []), c.at])
  let added = 0
  for (const r of rs) {
    const at = Date.parse(r.resolved_at as string)
    if ((known.get(r.id) ?? []).some((x) => Math.abs(x - at) < 60_000)) continue
    closures.push({ conversationId: r.id, at, by: r.resolved_by })
    added++
  }
  const basis: ResolutionBasis = added > 0 ? 'mixed' : 'events'
  return { closures, basis }
}

export async function buildReport(req: ReportRequest): Promise<ReportResult> {
  const ws = req.workspace
  const db = tenantDb(ws.id)
  const now = req.now ?? new Date()
  const personal = req.scope === 'personal'
  const options = await loadOptions(db)

  const agentId = personal ? req.userId : req.agentId
  const teamId = personal ? null : req.teamId
  if (req.channelId && !options.channels.some((c) => c.id === req.channelId)) return { ok: false, error: 'invalid_filter' }
  if (agentId && !options.agents.some((a) => a.id === agentId)) return { ok: false, error: 'invalid_filter' }
  if (teamId && !options.teams?.some((t) => t.id === teamId)) return { ok: false, error: 'invalid_filter' }

  const filterArgs: FilterArgs = {
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
    reportsVolume(filterArgs, from, to, req.range.timeZone),
    reportsStream(filterArgs, streamFrom, streamTo, STREAM_LIMIT),
    reportsSnapshot(filterArgs),
    personal ? Promise.resolve(null) : reportsBusiness(filterArgs, from, to),
    loadClosures(db, streamFrom, streamTo),
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
  const db = tenantDb(workspaceId)
  const data = await db.workspaces.findFirstOrThrow({ select: { settings: true }, where: { id: workspaceId } })
  const settings = (data?.settings ?? {}) as Record<string, unknown>
  const reports = { ...((settings.reports ?? {}) as Record<string, unknown>) }
  if (patch.sla_minutes !== undefined) reports.sla_minutes = patch.sla_minutes
  if (patch.usd_rate !== undefined) {
    if (patch.usd_rate === null) delete reports.usd_rate
    else reports.usd_rate = patch.usd_rate
  }
  await db.workspaces.updateMany({ where: { id: workspaceId }, data: { settings: { ...settings, reports } as object } })
  return reports
}
