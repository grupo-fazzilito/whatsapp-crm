import 'server-only'
import { prisma } from '@/lib/db/prisma'
import type { TenantDb } from '@/lib/db/tenant'
import { isUuid } from '@/lib/workspace/constants'
import { TASK_PRIORITIES } from './tasks'

// Server side of the CRM widgets (deals, tasks, pipelines, contacts).
// Every id that comes from the browser is checked against the caller's
// workspace before it is written (RLS used to scope reads only).

// ------------------------------------------------------------------
// Ownership checks
// ------------------------------------------------------------------

type Owned = 'contacts' | 'conversations' | 'deals' | 'pipelines' | 'pipeline_stages' | 'tags' | 'custom_fields' | 'tasks'

/** True when `id` is a row of `model` in the tenant's workspace. */
export async function owns(db: TenantDb, model: Owned, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const delegate = db[model] as unknown as { findFirst(args: { select: { id: true }; where: { id: string } }): Promise<{ id: string } | null> }
  return !!(await delegate.findFirst({ select: { id: true }, where: { id } }))
}

/** Active member of the workspace (task assignees). */
export async function isActiveMember(db: TenantDb, userId: string): Promise<boolean> {
  if (!isUuid(userId)) return false
  return !!(await db.workspace_members.findFirst({ select: { id: true }, where: { user_id: userId, status: 'active' } }))
}

/** Profiles (deal owners) of the workspace's active members. */
export async function memberProfiles(db: TenantDb) {
  const members = await db.workspace_members.findMany({ select: { user_id: true }, where: { status: 'active' } })
  if (!members.length) return []
  // Platform client: profiles have no workspace; limited to this workspace's members.
  return prisma.profiles.findMany({
    select: { id: true, user_id: true, full_name: true, email: true, avatar_url: true, role: true, created_at: true },
    where: { user_id: { in: members.map((m) => m.user_id) } },
    orderBy: { full_name: 'asc' },
  })
}

/** deals.assigned_to must be the profile of an active member. */
export async function isMemberProfile(db: TenantDb, profileId: string): Promise<boolean> {
  if (!isUuid(profileId)) return false
  const profile = await prisma.profiles.findFirst({ select: { user_id: true }, where: { id: profileId } })
  return !!profile && (await isActiveMember(db, profile.user_id))
}

// ------------------------------------------------------------------
// Input helpers
// ------------------------------------------------------------------

export const clip = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

/** undefined = key absent, null = cleared, string = valid uuid; false = invalid. */
export function optionalId(body: Record<string, unknown>, key: string): string | null | undefined | false {
  if (!(key in body)) return undefined
  const v = body[key]
  if (v === null || v === '') return null
  return typeof v === 'string' && isUuid(v) ? v : false
}

function isoOrNull(v: unknown): string | null | false {
  if (v === null || v === '' || v === undefined) return null
  if (typeof v !== 'string') return false
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? false : d.toISOString()
}

function dateOrNull(v: unknown): string | null | false {
  if (v === null || v === '' || v === undefined) return null
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : false
}

// ------------------------------------------------------------------
// Tasks
// ------------------------------------------------------------------

// Same row as '*, contact:contacts(id, name, phone), deal:deals(id, title)'.
export const TASK_INCLUDE = { contacts: { select: { id: true, name: true, phone: true } }, deals: { select: { id: true, title: true } } } as const
export function taskRow<T extends { contacts: unknown; deals: unknown }>({ contacts, deals, ...rest }: T) {
  return { ...rest, contact: contacts, deal: deals }
}

export interface TaskFields {
  title?: string
  description?: string | null
  due_at?: string | null
  priority?: string
  status?: string
  result?: string | null
  assignee_user_id?: string | null
  contact_id?: string | null
  conversation_id?: string | null
  deal_id?: string | null
}

/**
 * Validates task fields from the browser (create: title required). Links
 * (contact, conversation, deal, assignee) must belong to the workspace.
 */
export async function parseTaskInput(
  db: TenantDb,
  body: Record<string, unknown>,
  mode: 'create' | 'update',
): Promise<{ ok: true; data: TaskFields } | { ok: false; error: string }> {
  const data: TaskFields = {}
  if (mode === 'create' || 'title' in body) {
    const title = clip(body.title, 300)
    if (!title) return { ok: false, error: 'title_required' }
    data.title = title
  }
  if ('description' in body) data.description = clip(body.description, 5000)
  if ('due_at' in body) {
    const due = isoOrNull(body.due_at)
    if (due === false) return { ok: false, error: 'invalid_due_at' }
    data.due_at = due
  }
  if ('priority' in body) {
    if (!(TASK_PRIORITIES as readonly unknown[]).includes(body.priority)) return { ok: false, error: 'invalid_priority' }
    data.priority = body.priority as string
  }
  if (mode === 'update' && 'status' in body) {
    if (body.status !== 'open' && body.status !== 'cancelled') return { ok: false, error: 'invalid_status' }
    data.status = body.status
  }
  if (mode === 'update' && 'result' in body) data.result = clip(body.result, 5000)

  const links: [string, Owned | 'member'][] = [
    ['assignee_user_id', 'member'],
    ['contact_id', 'contacts'],
    ['conversation_id', 'conversations'],
    ['deal_id', 'deals'],
  ]
  for (const [key, model] of links) {
    const id = optionalId(body, key)
    if (id === false) return { ok: false, error: `invalid_${key}` }
    if (id === undefined) continue
    if (id && !(model === 'member' ? await isActiveMember(db, id) : await owns(db, model, id))) return { ok: false, error: `invalid_${key}` }
    data[key as 'assignee_user_id' | 'contact_id' | 'conversation_id' | 'deal_id'] = id
  }
  return { ok: true, data }
}

export interface TaskListFilters {
  status: 'open' | 'done'
  assignee?: string | null
  contactId?: string | null
  limit: number
}

export async function listTasks(db: TenantDb, f: TaskListFilters) {
  const rows = await db.tasks.findMany({
    where: {
      status: f.status,
      ...(f.assignee ? { assignee_user_id: f.assignee } : {}),
      ...(f.contactId ? { contact_id: f.contactId } : {}),
    },
    include: TASK_INCLUDE,
    orderBy: f.status === 'open' ? { due_at: { sort: 'asc', nulls: 'last' } } : { completed_at: 'desc' },
    take: f.limit,
  })
  return rows.map(taskRow)
}

// ------------------------------------------------------------------
// Deals
// ------------------------------------------------------------------

export interface DealFields {
  title?: string
  value?: number
  currency?: string | null
  notes?: string | null
  expected_close_date?: string | null
  contact_id?: string | null
  conversation_id?: string | null
  assigned_to?: string | null
  pipeline_id?: string
  stage_id?: string
}

/** Validates deal fields (create: title, pipeline and stage required; stage must be in the pipeline). */
export async function parseDealInput(
  db: TenantDb,
  body: Record<string, unknown>,
  mode: 'create' | 'update',
  current?: { pipeline_id: string; stage_id: string },
): Promise<{ ok: true; data: DealFields } | { ok: false; error: string }> {
  const data: DealFields = {}
  if (mode === 'create' || 'title' in body) {
    const title = clip(body.title, 200)
    if (!title) return { ok: false, error: 'title_required' }
    data.title = title
  }
  if ('value' in body) {
    const n = body.value === null || body.value === '' ? 0 : Number(body.value)
    if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'invalid_value' }
    data.value = Math.round(n * 100) / 100
  }
  if ('currency' in body) {
    const c = body.currency == null || body.currency === '' ? null : String(body.currency).toUpperCase()
    if (c !== null && !/^[A-Z]{3}$/.test(c)) return { ok: false, error: 'invalid_currency' }
    data.currency = c
  }
  if ('notes' in body) data.notes = clip(body.notes, 5000)
  if ('expected_close_date' in body) {
    const d = dateOrNull(body.expected_close_date)
    if (d === false) return { ok: false, error: 'invalid_expected_close_date' }
    data.expected_close_date = d
  }

  for (const [key, model] of [
    ['contact_id', 'contacts'],
    ['conversation_id', 'conversations'],
  ] as const) {
    const id = optionalId(body, key)
    if (id === false || (id && !(await owns(db, model, id)))) return { ok: false, error: `invalid_${key}` }
    if (id !== undefined) data[key] = id
  }
  const owner = optionalId(body, 'assigned_to')
  if (owner === false || (owner && !(await isMemberProfile(db, owner)))) return { ok: false, error: 'invalid_assigned_to' }
  if (owner !== undefined) data.assigned_to = owner

  const pipelineId = optionalId(body, 'pipeline_id')
  const stageId = optionalId(body, 'stage_id')
  if (pipelineId === false || pipelineId === null || stageId === false || stageId === null) return { ok: false, error: 'invalid_stage' }
  if (mode === 'create' && (!pipelineId || !stageId)) return { ok: false, error: 'invalid_stage' }
  if (pipelineId || stageId) {
    const pid = pipelineId ?? current?.pipeline_id
    const sid = stageId ?? current?.stage_id
    const stage = sid ? await db.pipeline_stages.findFirst({ select: { pipeline_id: true }, where: { id: sid } }) : null
    if (!stage || stage.pipeline_id !== pid) return { ok: false, error: 'invalid_stage' }
    data.pipeline_id = pid as string
    data.stage_id = sid
  }
  return { ok: true, data }
}

/** A contact's deals with their stage (all columns) and pipeline name. */
export async function contactDeals(db: TenantDb, contactId: string, opts: { status?: string | null; limit: number }) {
  const rows = await db.deals.findMany({
    where: { contact_id: contactId, ...(opts.status ? { status: opts.status } : {}) },
    include: { pipeline_stages: true, pipelines: { select: { name: true } } },
    orderBy: { created_at: 'desc' },
    take: opts.limit,
  })
  return rows.map(({ pipeline_stages, pipelines, ...d }) => ({ ...d, stage: pipeline_stages, pipeline: pipelines }))
}
