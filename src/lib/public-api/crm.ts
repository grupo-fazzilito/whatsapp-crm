import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { isPrismaError } from '@/lib/db/errors'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { TASK_PRIORITIES, TASK_STATUSES } from '@/lib/crm/tasks'
import type { ApiContext } from './auth'
import { badRequest, notFound, unprocessable } from './errors'
import { pgError } from './db-error'
import { keysetPage, selectOf } from './keyset'
import { parseIsoParam } from './pagination'
import { DEAL_SELECT, TASK_SELECT_API, serializeDeal, serializeTask } from './serializers'
import { isIsoDateOnly, isoDateTime, isUuidLike, num, oneOf, queryEnum, queryUuid, str, uuid } from './validate'

type Body = Record<string, unknown>
const DEAL_STATUSES = ['open', 'won', 'lost'] as const
const DEAL_FIELDS = selectOf(DEAL_SELECT)
const TASK_FIELDS = selectOf(TASK_SELECT_API)
type Row = Record<string, unknown> & { id: string }

// ------------------------------------------------------------
// Members & pipelines (lookups for ids)
// ------------------------------------------------------------
export async function listMembers(workspaceId: string) {
  const members = await tenantDb(workspaceId)
    .workspace_members.findMany({ select: { user_id: true, role: true, available: true }, where: { workspace_id: workspaceId, status: 'active' } })
    .catch(() => null)
  const ids = (members ?? []).map((m) => m.user_id as string)
  // profiles has no workspace_id: read with the system client, limited to the members above.
  const profiles = ids.length
    ? await prisma.profiles
        .findMany({ select: { id: true, user_id: true, full_name: true, email: true }, where: { user_id: { in: ids } } })
        .catch(() => null)
    : []
  const byUser = new Map((profiles ?? []).map((p) => [p.user_id as string, p]))
  return {
    data: (members ?? []).map((m) => {
      const p = byUser.get(m.user_id as string)
      return {
        user_id: m.user_id as string,
        profile_id: (p?.id as string) ?? null,
        name: (p?.full_name as string) ?? null,
        email: (p?.email as string) ?? null,
        role: m.role as string,
        available: m.available !== false,
      }
    }),
  }
}

export async function listPipelines(workspaceId: string) {
  const data = await tenantDb(workspaceId)
    .pipelines.findMany({
      select: {
        id: true,
        name: true,
        key: true,
        created_at: true,
        pipeline_stages: { select: { id: true, name: true, key: true, position: true, color: true } },
      },
      where: { workspace_id: workspaceId },
      orderBy: { created_at: 'asc' },
    })
    .catch(() => null)
  return {
    data: (data ?? []).map((p) => ({
      id: p.id as string,
      name: p.name as string,
      key: (p.key as string) ?? null,
      stages: ((p.pipeline_stages as unknown as { id: string; name: string; key: string | null; position: number; color: string }[]) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ id: s.id, name: s.name, key: s.key ?? null, position: s.position, color: s.color })),
    })),
  }
}

// ------------------------------------------------------------
// Deals
// ------------------------------------------------------------
export async function listDeals(workspaceId: string, url: URL) {
  const where: Record<string, unknown> = { workspace_id: workspaceId }
  for (const key of ['pipeline_id', 'stage_id', 'contact_id'] as const) {
    const v = queryUuid(url, key)
    if (v) where[key] = v
  }
  const status = queryEnum(url, 'status', DEAL_STATUSES)
  if (status) where.status = status
  const since = parseIsoParam(url.searchParams.get('updated_since'))
  if (since) where.updated_at = { gte: since }
  const db = tenantDb(workspaceId)
  const page = await keysetPage({
    workspaceId,
    table: 'deals',
    column: 'created_at',
    where,
    url,
    findMany: (args) => db.deals.findMany({ ...args, select: DEAL_FIELDS }) as unknown as Promise<Row[]>,
  })
  return { data: page.data.map(serializeDeal), next_cursor: page.next_cursor }
}

async function dealRow(workspaceId: string, id: string) {
  if (!isUuidLike(id)) throw notFound('Deal')
  const data = await tenantDb(workspaceId)
    .deals.findFirst({ select: DEAL_FIELDS, where: { id, workspace_id: workspaceId } })
    .catch(() => null)
  if (!data) throw notFound('Deal')
  return data as unknown as Row & { pipeline_id: string; stage_id: string }
}

export async function getDeal(workspaceId: string, id: string) {
  return serializeDeal(await dealRow(workspaceId, id))
}

async function stageOf(workspaceId: string, pipelineId: string, stageId: string | null | undefined) {
  const data = await tenantDb(workspaceId)
    .pipeline_stages.findFirst({
      select: { id: true },
      where: { workspace_id: workspaceId, pipeline_id: pipelineId, ...(stageId ? { id: stageId } : {}) },
      ...(stageId ? {} : { orderBy: { position: 'asc' as const } }),
    })
    .catch(() => null)
  if (!data) throw unprocessable('invalid_stage', stageId ? 'stage_id is not a stage of this pipeline.' : 'The pipeline has no stages.', { field: 'stage_id' })
  return data.id as string
}

async function checkRefs(workspaceId: string, row: Record<string, unknown>) {
  const db = tenantDb(workspaceId)
  for (const [field, table] of [['contact_id', 'contacts'], ['conversation_id', 'conversations']] as const) {
    const id = row[field] as string | null | undefined
    if (!id) continue
    const args = { select: { id: true }, where: { id, workspace_id: workspaceId } } as const
    const data = await (table === 'contacts' ? db.contacts.findFirst(args) : db.conversations.findFirst(args)).catch(() => null)
    if (!data) throw unprocessable('invalid_reference', `${field} doesn't belong to this workspace.`, { field })
  }
  const assigned = row.assigned_to as string | null | undefined
  if (assigned) {
    const members = await listMembers(workspaceId)
    if (!members.data.some((m) => m.profile_id === assigned)) {
      throw unprocessable('invalid_reference', 'assigned_to must be the profile_id of an active member (GET /members).', { field: 'assigned_to' })
    }
  }
}

function readCurrencyCode(body: Body): string | undefined {
  const c = str(body, 'currency', { max: 3 })
  if (c === undefined || c === null) return undefined
  if (!/^[A-Za-z]{3}$/.test(c)) throw badRequest('currency must be an ISO 4217 code, e.g. PEN.', { field: 'currency' })
  return c.toUpperCase()
}

export async function createDeal(ctx: ApiContext, body: Body) {
  const ws = ctx.workspace.id
  const pipelineId = uuid(body, 'pipeline_id', { required: true })!
  const pipeline = await tenantDb(ws)
    .pipelines.findFirst({ select: { id: true }, where: { id: pipelineId, workspace_id: ws } })
    .catch(() => null)
  if (!pipeline) throw unprocessable('invalid_reference', 'pipeline_id is not a pipeline of this workspace.', { field: 'pipeline_id' })
  const row: Record<string, unknown> = {
    workspace_id: ws,
    pipeline_id: pipelineId,
    stage_id: await stageOf(ws, pipelineId, uuid(body, 'stage_id')),
    title: str(body, 'title', { required: true, max: 200 }),
    value: num(body, 'value', { min: 0, max: 1e13 }) ?? 0,
    currency: readCurrencyCode(body) ?? ctx.workspace.currency,
    contact_id: uuid(body, 'contact_id') ?? null,
    conversation_id: uuid(body, 'conversation_id') ?? null,
    assigned_to: uuid(body, 'assigned_to') ?? null,
    notes: str(body, 'notes', { max: 5000 }) ?? null,
  }
  const close = str(body, 'expected_close_date')
  if (close) {
    if (!isIsoDateOnly(close)) throw badRequest('expected_close_date must be YYYY-MM-DD.', { field: 'expected_close_date' })
    row.expected_close_date = close
  }
  await checkRefs(ws, row)
  const data = await tenantDb(ws).deals.create({ data: row as Prisma.dealsUncheckedCreateInput, select: { id: true } })
  return getDeal(ws, data.id)
}

export async function updateDeal(ctx: ApiContext, id: string, body: Body) {
  const ws = ctx.workspace.id
  const current = await dealRow(ws, id)
  const patch: Record<string, unknown> = {}
  const title = str(body, 'title', { max: 200, nullable: false })
  if (title !== undefined) patch.title = title
  const value = num(body, 'value', { min: 0, max: 1e13 })
  if (value !== undefined) patch.value = value ?? 0
  const currency = readCurrencyCode(body)
  if (currency) patch.currency = currency
  const stageId = uuid(body, 'stage_id')
  if (stageId) patch.stage_id = await stageOf(ws, current.pipeline_id, stageId)
  for (const key of ['contact_id', 'conversation_id', 'assigned_to'] as const) {
    const v = uuid(body, key)
    if (v !== undefined) patch[key] = v
  }
  const notes = str(body, 'notes', { max: 5000 })
  if (notes !== undefined) patch.notes = notes
  const close = str(body, 'expected_close_date')
  if (close !== undefined) {
    if (close && !isIsoDateOnly(close)) throw badRequest('expected_close_date must be YYYY-MM-DD.', { field: 'expected_close_date' })
    patch.expected_close_date = close
  }
  const status = oneOf(body, 'status', DEAL_STATUSES)
  if (status) {
    patch.status = status
    const reason = str(body, 'lost_reason', { max: 200 })
    if (status === 'lost') {
      if (!reason) throw badRequest('lost_reason is required when status is lost.', { field: 'lost_reason' })
      patch.lost_reason = reason
    }
  }
  if (!Object.keys(patch).length) throw badRequest('Nothing to update.')
  await checkRefs(ws, patch)
  await tenantDb(ws).deals.updateMany({ where: { id, workspace_id: ws }, data: patch })
  return getDeal(ws, id)
}

// ------------------------------------------------------------
// Tasks
// ------------------------------------------------------------
export async function listTasks(workspaceId: string, url: URL) {
  const where: Record<string, unknown> = { workspace_id: workspaceId }
  const status = queryEnum(url, 'status', TASK_STATUSES)
  if (status) where.status = status
  for (const key of ['assignee_user_id', 'contact_id', 'deal_id', 'conversation_id'] as const) {
    const v = queryUuid(url, key)
    if (v) where[key] = v
  }
  const db = tenantDb(workspaceId)
  const page = await keysetPage({
    workspaceId,
    table: 'tasks',
    column: 'created_at',
    where,
    url,
    findMany: (args) => db.tasks.findMany({ ...args, select: TASK_FIELDS }) as unknown as Promise<Row[]>,
  })
  return { data: page.data.map(serializeTask), next_cursor: page.next_cursor }
}

export async function createTask(ctx: ApiContext, body: Body) {
  const ws = ctx.workspace.id
  const row: Record<string, unknown> = {
    workspace_id: ws,
    title: str(body, 'title', { required: true, max: 300 }),
    description: str(body, 'description', { max: 5000 }) ?? null,
    due_at: isoDateTime(body, 'due_at') ?? null,
    priority: oneOf(body, 'priority', TASK_PRIORITIES) ?? 'normal',
    assignee_user_id: uuid(body, 'assignee_user_id') ?? null,
    contact_id: uuid(body, 'contact_id') ?? null,
    conversation_id: uuid(body, 'conversation_id') ?? null,
    deal_id: uuid(body, 'deal_id') ?? null,
    created_by: ctx.createdBy,
  }
  let data: Row
  try {
    data = (await tenantDb(ws).tasks.create({ data: row as Prisma.tasksUncheckedCreateInput, select: TASK_FIELDS })) as unknown as Row
  } catch (err) {
    // Same-workspace checks live in the tasks trigger (033).
    const error = pgError(err)
    if (error.code === '23514' || error.code === '23503' || isPrismaError(err, 'P2003')) {
      throw unprocessable('invalid_reference', error.message.includes('assignee') ? 'assignee_user_id is not an active member.' : 'A linked contact, conversation or deal is not in this workspace.')
    }
    throw err
  }
  return serializeTask(data)
}
