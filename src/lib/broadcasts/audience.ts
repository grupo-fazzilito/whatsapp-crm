import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import type { TenantDb } from '@/lib/db/tenant'
import { isUuid } from '@/lib/workspace/constants'

// Broadcast audiences and recipient bookkeeping for the broadcast wizard
// (behind /api/broadcasts/{audience,prepare,[id]/progress}). Tenant client:
// tag / field / contact ids from the browser only match rows of the
// caller's workspace.

export type CustomFieldOperator = 'is' | 'is_not' | 'contains'

export interface AudienceInput {
  type: 'all' | 'tags' | 'custom_field' | 'csv'
  tagIds?: string[]
  customField?: { fieldId: string; operator: CustomFieldOperator; value: string }
  csvContacts?: { phone: string; name?: string }[]
  excludeTagIds?: string[]
}

const MAX_IDS = 500
const MAX_CSV = 50_000
const OPERATORS = ['is', 'is_not', 'contains']

function uuidList(v: unknown): string[] | null {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v) || v.length > MAX_IDS || !v.every((x) => typeof x === 'string' && isUuid(x))) return null
  return [...new Set(v as string[])]
}

/** Validates the wizard's AudienceConfig. */
export function parseAudience(raw: unknown): { ok: true; value: AudienceInput } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'audience is required' }
  const a = raw as Record<string, unknown>
  if (!['all', 'tags', 'custom_field', 'csv'].includes(a.type as string)) return { ok: false, error: 'invalid audience type' }
  const tagIds = uuidList(a.tagIds)
  const excludeTagIds = uuidList(a.excludeTagIds)
  if (!tagIds || !excludeTagIds) return { ok: false, error: 'invalid tag ids' }
  const value: AudienceInput = { type: a.type as AudienceInput['type'], tagIds, excludeTagIds }

  if (a.customField !== undefined && a.customField !== null) {
    const cf = a.customField as Record<string, unknown>
    if (typeof cf !== 'object' || !isUuid(cf.fieldId as string) || !OPERATORS.includes(cf.operator as string) || typeof cf.value !== 'string') {
      // A half-filled filter (no field picked yet) only matters for custom_field audiences.
      if (value.type === 'custom_field') return { ok: false, error: 'invalid custom field filter' }
    } else {
      value.customField = { fieldId: cf.fieldId as string, operator: cf.operator as CustomFieldOperator, value: (cf.value as string).slice(0, 500) }
    }
  }
  if (value.type === 'csv') {
    if (!Array.isArray(a.csvContacts) || a.csvContacts.length > MAX_CSV) return { ok: false, error: 'invalid csv contacts' }
    const rows: { phone: string; name?: string }[] = []
    for (const r of a.csvContacts as unknown[]) {
      const row = r as Record<string, unknown> | null
      if (!row || typeof row.phone !== 'string') return { ok: false, error: 'invalid csv contacts' }
      rows.push({ phone: row.phone.slice(0, 40), name: typeof row.name === 'string' ? row.name.slice(0, 200) : undefined })
    }
    value.csvContacts = rows
  }
  return { ok: true, value }
}

async function contactIdsWithTags(db: TenantDb, tagIds: string[]): Promise<string[]> {
  if (!tagIds.length) return []
  const rows = await db.contact_tags.findMany({ select: { contact_id: true }, where: { tag_id: { in: tagIds } } })
  return rows.map((r) => r.contact_id)
}

async function contactIdsWithField(db: TenantDb, f: NonNullable<AudienceInput['customField']>): Promise<string[]> {
  const value: Prisma.StringNullableFilter =
    f.operator === 'is' ? { equals: f.value } : f.operator === 'is_not' ? { not: f.value } : { contains: f.value, mode: 'insensitive' }
  const rows = await db.contact_custom_values.findMany({ select: { contact_id: true }, where: { custom_field_id: f.fieldId, value } })
  return rows.map((r) => r.contact_id)
}

/**
 * Estimated reach shown while the audience is being built (step 2). Null
 * while the audience is only partially configured.
 */
export async function estimateAudience(db: TenantDb, a: AudienceInput): Promise<number | null> {
  let baseIds: Set<string> | null = null // null = every contact
  if (a.type === 'all') {
    // counted below
  } else if (a.type === 'tags' && a.tagIds?.length) {
    baseIds = new Set(await contactIdsWithTags(db, a.tagIds))
  } else if (a.type === 'custom_field' && a.customField?.fieldId && a.customField.value) {
    baseIds = new Set(await contactIdsWithField(db, a.customField))
  } else if (a.type === 'csv' && a.csvContacts?.length) {
    return a.csvContacts.length
  } else {
    return null
  }
  const exclude = a.excludeTagIds?.length ? new Set(await contactIdsWithTags(db, a.excludeTagIds)) : null
  if (baseIds) return [...baseIds].filter((id) => !exclude?.has(id)).length
  const total = await db.contacts.count()
  return exclude ? Math.max(0, total - exclude.size) : total
}

/** Finds CSV phones among the workspace contacts and creates the missing ones. */
async function upsertCsvContacts(db: TenantDb, workspaceId: string, userId: string, csvRows: { phone: string; name?: string }[]) {
  const byPhoneInput = new Map<string, { phone: string; name?: string }>()
  for (const r of csvRows) if (r.phone) byPhoneInput.set(r.phone, r)
  const phones = [...byPhoneInput.keys()]
  if (!phones.length) return []

  const existing = await db.contacts.findMany({ where: { phone: { in: phones } } })
  const byPhone = new Map<string, (typeof existing)[number]>()
  for (const c of existing) if (c.phone) byPhone.set(c.phone, c)

  const missing = phones.filter((p) => !byPhone.has(p))
  for (let i = 0; i < missing.length; i += 200) {
    const created = await db.contacts.createManyAndReturn({
      data: missing.slice(i, i + 200).map((phone) => ({
        workspace_id: workspaceId,
        user_id: userId,
        phone,
        name: byPhoneInput.get(phone)?.name ?? null,
      })),
    })
    for (const c of created) if (c.phone) byPhone.set(c.phone, c)
  }
  // Input order, so the send order roughly matches the CSV.
  return phones.map((p) => byPhone.get(p)).filter((c): c is NonNullable<typeof c> => Boolean(c))
}

/** Contacts a broadcast goes to (exclusions applied). */
export async function resolveAudience(db: TenantDb, workspaceId: string, userId: string, a: AudienceInput) {
  let contacts: Awaited<ReturnType<TenantDb['contacts']['findMany']>> = []
  if (a.type === 'all') {
    contacts = await db.contacts.findMany()
  } else if (a.type === 'tags' && a.tagIds?.length) {
    const ids = [...new Set(await contactIdsWithTags(db, a.tagIds))]
    if (ids.length) contacts = await db.contacts.findMany({ where: { id: { in: ids } } })
  } else if (a.type === 'custom_field' && a.customField) {
    const ids = [...new Set(await contactIdsWithField(db, a.customField))]
    if (ids.length) contacts = await db.contacts.findMany({ where: { id: { in: ids } } })
  } else if (a.type === 'csv' && a.csvContacts) {
    contacts = await upsertCsvContacts(db, workspaceId, userId, a.csvContacts)
  }
  if (a.excludeTagIds?.length) {
    const excluded = new Set(await contactIdsWithTags(db, a.excludeTagIds))
    contacts = contacts.filter((c) => !excluded.has(c.id))
  }
  return contacts
}

export class EmptyAudienceError extends Error {
  constructor() {
    super('No contacts found for this audience.')
  }
}

export interface PrepareInput {
  name: string
  templateName: string
  templateLanguage: string
  variables: Record<string, unknown>
  audience: AudienceInput
}

/**
 * Resolves the audience, creates the broadcast ("sending") with one pending
 * recipient per contact, and returns the recipients with their contact plus
 * every custom value of those contacts (contact id → field id → value).
 * When a recipient batch fails the broadcast is flipped to "failed".
 */
export async function prepareBroadcast(db: TenantDb, workspaceId: string, userId: string, input: PrepareInput) {
  const contacts = await resolveAudience(db, workspaceId, userId, input.audience)
  if (contacts.length === 0) throw new EmptyAudienceError()

  const broadcast = await db.broadcasts.create({
    data: {
      workspace_id: workspaceId,
      user_id: userId,
      name: input.name,
      template_name: input.templateName,
      template_language: input.templateLanguage,
      template_variables: input.variables as Prisma.InputJsonValue,
      audience_filter: {
        type: input.audience.type,
        tagIds: input.audience.tagIds,
        customField: input.audience.customField,
        excludeTagIds: input.audience.excludeTagIds,
      } as Prisma.InputJsonValue,
      status: 'sending',
      total_recipients: contacts.length,
      sent_count: 0,
      delivered_count: 0,
      read_count: 0,
      replied_count: 0,
      failed_count: 0,
    },
  })

  const rows = contacts.map((c) => ({ workspace_id: workspaceId, broadcast_id: broadcast.id, contact_id: c.id, status: 'pending' }))
  for (let i = 0; i < rows.length; i += 200) {
    try {
      await db.broadcast_recipients.createMany({ data: rows.slice(i, i + 200) })
    } catch (err) {
      await db.broadcasts.updateMany({ where: { id: broadcast.id }, data: { status: 'failed', failed_count: contacts.length } })
      throw new Error(`Failed to insert recipient batch ${i / 200 + 1}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const recipientRows = await db.broadcast_recipients.findMany({ where: { broadcast_id: broadcast.id }, include: { contacts: true } })
  const recipients = recipientRows.map(({ contacts: contact, ...r }) => ({ ...r, contact: contact ?? null }))

  const customValues: Record<string, Record<string, string>> = {}
  const ids = recipients.map((r) => r.contact?.id).filter((id): id is string => Boolean(id))
  for (let i = 0; i < ids.length; i += 500) {
    const vals = await db.contact_custom_values.findMany({
      select: { contact_id: true, custom_field_id: true, value: true },
      where: { contact_id: { in: ids.slice(i, i + 500) } },
    })
    for (const v of vals) (customValues[v.contact_id] ??= {})[v.custom_field_id] = v.value ?? ''
  }
  return { broadcast, recipients, customValues }
}

export interface RecipientUpdate {
  id: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string | null
  error_message?: string | null
}

export function parseRecipientUpdates(raw: unknown): RecipientUpdate[] | null {
  if (raw === undefined) return []
  if (!Array.isArray(raw) || raw.length > 500) return null
  const out: RecipientUpdate[] = []
  for (const u of raw as Record<string, unknown>[]) {
    if (!u || !isUuid(u.id as string) || (u.status !== 'sent' && u.status !== 'failed')) return null
    out.push({
      id: u.id as string,
      status: u.status,
      whatsapp_message_id: typeof u.whatsapp_message_id === 'string' ? u.whatsapp_message_id.slice(0, 200) : null,
      error_message: typeof u.error_message === 'string' ? u.error_message.slice(0, 1000) : null,
    })
  }
  return out
}

/**
 * Records send results of recipients of `broadcastId` and, when given, the
 * final status. False when the broadcast isn't in the workspace.
 */
export async function recordBroadcastProgress(
  db: TenantDb,
  broadcastId: string,
  updates: RecipientUpdate[],
  finalStatus?: 'sent' | 'failed',
): Promise<boolean> {
  const broadcast = await db.broadcasts.findFirst({ select: { id: true }, where: { id: broadcastId } })
  if (!broadcast) return false
  const now = new Date()
  for (const u of updates) {
    const data =
      u.status === 'sent'
        ? { status: 'sent', sent_at: now, whatsapp_message_id: u.whatsapp_message_id ?? null, error_message: null }
        : { status: 'failed', error_message: u.error_message ?? 'Unknown error' }
    await db.broadcast_recipients.updateMany({ where: { id: u.id, broadcast_id: broadcastId }, data })
  }
  if (finalStatus) await db.broadcasts.updateMany({ where: { id: broadcastId }, data: { status: finalStatus } })
  return true
}
