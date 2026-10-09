import 'server-only'
import { isPrismaError } from '@/lib/db/errors'
import { tenantDb } from '@/lib/db/tenant'
import { phonesMatch, normalizePhone } from '@/lib/whatsapp/phone-utils'
import { ApiError, badRequest, notFound } from './errors'
import { keysetPage } from './keyset'
import { parseIsoParam } from './pagination'
import { serializeContact, serializeTag } from './serializers'
import { has, isUuidLike, queryUuid, str, strArray } from './validate'

type Body = Record<string, unknown>

// CONTACT_SELECT (serializers.ts) as a Prisma select: contact_tags(tag:tags(id, name, color)).
const TAG_FIELDS = { id: true, name: true, color: true } as const
const CONTACT_FIELDS = {
  id: true,
  name: true,
  phone: true,
  email: true,
  company: true,
  avatar_url: true,
  created_at: true,
  updated_at: true,
} as const

function contactSelect(tagId?: string | null) {
  return {
    ...CONTACT_FIELDS,
    // With a tag filter PostgREST (contact_tags!inner) embedded only the matching link.
    contact_tags: { select: { tags: { select: TAG_FIELDS } }, ...(tagId ? { where: { tag_id: tagId } } : {}) },
  }
}

type ContactRow = Record<string, unknown> & { id: string; phone: string | null; contact_tags: { tag: Record<string, unknown> | null }[] }

/** Prisma row → the PostgREST row shape serializeContact reads. */
function contactRow(r: { contact_tags: { tags: Record<string, unknown> | null }[] } & Record<string, unknown>): ContactRow {
  const { contact_tags, ...rest } = r
  return { ...rest, contact_tags: contact_tags.map((ct) => ({ tag: ct.tags })) } as ContactRow
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** "+51 987 654 321" → "+51987654321" (E.164-like), or throws 400. */
export function normalizeApiPhone(raw: string): string {
  const digits = normalizePhone(raw)
  if (!/^[1-9]\d{6,14}$/.test(digits)) throw badRequest('phone must be in international format, e.g. +51987654321.', { field: 'phone' })
  return `+${digits}`
}

export async function findContactsByPhone(workspaceId: string, phone: string) {
  const digits = normalizePhone(phone)
  if (digits.length < 6) return []
  const data = await tenantDb(workspaceId)
    .contacts.findMany({
      select: contactSelect(),
      where: { workspace_id: workspaceId, phone: { contains: digits.slice(-8), mode: 'insensitive' } },
      take: 50,
    })
    .catch(() => null)
  return (data ?? []).map(contactRow).filter((c) => c.phone && phonesMatch(c.phone, phone))
}

export async function listContacts(workspaceId: string, url: URL) {
  const sp = url.searchParams
  const phone = sp.get('phone')
  if (phone) {
    const rows = await findContactsByPhone(workspaceId, phone)
    return { data: rows.map(serializeContact), next_cursor: null }
  }
  const db = tenantDb(workspaceId)
  const tagId = queryUuid(url, 'tag_id')
  const where: Record<string, unknown> = { workspace_id: workspaceId }
  const email = sp.get('email')
  // ilike with escaped wildcards = case-insensitive equality.
  if (email) where.email = { equals: email, mode: 'insensitive' }
  const search = sp.get('q')?.trim()
  if (search) where.name = { contains: search.replace(/[%_,()]/g, ' ').slice(0, 100), mode: 'insensitive' }
  if (tagId) where.contact_tags = { some: { tag_id: tagId } }
  const since = parseIsoParam(sp.get('updated_since'))
  if (since) where.updated_at = { gte: since }
  const page = await keysetPage({
    workspaceId,
    table: 'contacts',
    column: 'created_at',
    where,
    url,
    findMany: async (args) => (await db.contacts.findMany({ ...args, select: contactSelect(tagId) })).map(contactRow),
  })
  return { data: page.data.map(serializeContact), next_cursor: page.next_cursor }
}

export async function getContactRow(workspaceId: string, id: string) {
  if (!isUuidLike(id)) throw notFound('Contact')
  const data = await tenantDb(workspaceId)
    .contacts.findFirst({ select: contactSelect(), where: { id, workspace_id: workspaceId } })
    .catch(() => null)
  if (!data) throw notFound('Contact')
  return contactRow(data)
}

export async function getContact(workspaceId: string, id: string) {
  return serializeContact(await getContactRow(workspaceId, id))
}

function readContactFields(body: Body, partial: boolean) {
  const out: Record<string, string | null> = {}
  const name = str(body, 'name', { max: 200 })
  if (name !== undefined) out.name = name
  if (has(body, 'phone')) {
    const p = str(body, 'phone', { max: 40 })
    out.phone = p ? normalizeApiPhone(p) : null
  }
  if (has(body, 'email')) {
    const e = str(body, 'email', { max: 254 })
    if (e && !EMAIL_RE.test(e)) throw badRequest('email is not valid.', { field: 'email' })
    out.email = e ? e.toLowerCase() : null
  }
  const company = str(body, 'company', { max: 200 })
  if (company !== undefined) out.company = company
  if (!partial && !out.name && !out.phone && !out.email) throw badRequest('Send at least one of name, phone or email.')
  return out
}

export async function createContact(workspaceId: string, body: Body) {
  const fields = readContactFields(body, false)
  const tags = strArray(body, 'tags', { max: 20, itemMax: 50 })
  if (fields.phone) {
    const dup = await findContactsByPhone(workspaceId, fields.phone)
    if (dup.length) {
      throw new ApiError(409, 'contact_exists', 'A contact with this phone already exists.', { contact_id: dup[0].id })
    }
  }
  const data = await tenantDb(workspaceId).contacts.create({
    data: { workspace_id: workspaceId, name: fields.name ?? fields.phone ?? fields.email, ...fields },
    select: { id: true },
  })
  for (const tag of tags ?? []) await addTag(workspaceId, data.id, { name: tag })
  return getContact(workspaceId, data.id)
}

export async function updateContact(workspaceId: string, id: string, body: Body) {
  await getContactRow(workspaceId, id)
  const fields = readContactFields(body, true)
  if (!Object.keys(fields).length) throw badRequest('Nothing to update. Fields: name, phone, email, company.')
  if (fields.phone) {
    const dup = (await findContactsByPhone(workspaceId, fields.phone)).filter((c) => c.id !== id)
    if (dup.length) throw new ApiError(409, 'contact_exists', 'Another contact already has this phone.', { contact_id: dup[0].id })
  }
  await tenantDb(workspaceId).contacts.updateMany({ where: { id, workspace_id: workspaceId }, data: fields })
  return getContact(workspaceId, id)
}

// ------------------------------------------------------------
// Tags
// ------------------------------------------------------------
export async function listTags(workspaceId: string) {
  const data = await tenantDb(workspaceId)
    .tags.findMany({ select: TAG_FIELDS, where: { workspace_id: workspaceId }, orderBy: { name: 'asc' } })
    .catch(() => null)
  return { data: (data ?? []).map(serializeTag) }
}

const TAG_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b']

/** Attaches a tag (by id, or by name — created when missing). */
export async function addTag(workspaceId: string, contactId: string, input: { tag_id?: string | null; name?: string | null; color?: string | null }) {
  const db = tenantDb(workspaceId)
  let tag: { id: string; name: string; color: string | null } | null = null
  if (input.tag_id) {
    if (!isUuidLike(input.tag_id)) throw badRequest('tag_id must be an id (UUID).', { field: 'tag_id' })
    const data = await db.tags.findFirst({ select: TAG_FIELDS, where: { id: input.tag_id, workspace_id: workspaceId } }).catch(() => null)
    if (!data) throw notFound('Tag')
    tag = data
  } else if (input.name?.trim()) {
    const name = input.name.trim().slice(0, 50)
    const existing = await db.tags
      .findFirst({ select: TAG_FIELDS, where: { workspace_id: workspaceId, name: { equals: name, mode: 'insensitive' } } })
      .catch(() => null)
    tag = existing
    if (!tag) {
      const color = input.color && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
      tag = await db.tags.create({ data: { workspace_id: workspaceId, name, color }, select: TAG_FIELDS })
    }
  } else {
    throw badRequest('Send tag_id or name.')
  }
  const link = await db.contact_tags.findFirst({ select: { id: true }, where: { contact_id: contactId, tag_id: tag!.id } }).catch(() => null)
  if (!link) {
    try {
      await db.contact_tags.create({ data: { workspace_id: workspaceId, contact_id: contactId, tag_id: tag!.id } })
    } catch (error) {
      if (!isPrismaError(error, 'P2002')) throw error
    }
  }
  return serializeTag(tag!)
}

export async function contactTags(workspaceId: string, contactId: string) {
  return { data: serializeContact(await getContactRow(workspaceId, contactId)).tags }
}

export async function removeTag(workspaceId: string, contactId: string, tagId: string) {
  await getContactRow(workspaceId, contactId)
  if (!isUuidLike(tagId)) throw notFound('Tag')
  await tenantDb(workspaceId)
    .contact_tags.deleteMany({ where: { workspace_id: workspaceId, contact_id: contactId, tag_id: tagId } })
    .catch(() => null)
  return { deleted: true }
}
