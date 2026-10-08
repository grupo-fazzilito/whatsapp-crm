import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { phonesMatch, normalizePhone } from '@/lib/whatsapp/phone-utils'
import { ApiError, badRequest, notFound } from './errors'
import { listPage } from './list'
import { parseIsoParam } from './pagination'
import { CONTACT_SELECT, serializeContact, serializeTag } from './serializers'
import { has, isUuidLike, queryUuid, str, strArray } from './validate'

type Body = Record<string, unknown>

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
  const { data } = await supabaseAdmin()
    .from('contacts')
    .select(CONTACT_SELECT)
    .eq('workspace_id', workspaceId)
    .ilike('phone', `%${digits.slice(-8)}%`)
    .limit(50)
  return (data ?? []).filter((c) => c.phone && phonesMatch(c.phone, phone))
}

export async function listContacts(workspaceId: string, url: URL) {
  const sp = url.searchParams
  const phone = sp.get('phone')
  if (phone) {
    const rows = await findContactsByPhone(workspaceId, phone)
    return { data: rows.map(serializeContact), next_cursor: null }
  }
  const db = supabaseAdmin()
  const tagId = queryUuid(url, 'tag_id')
  let q = db
    .from('contacts')
    .select(tagId ? CONTACT_SELECT.replace('contact_tags(', 'contact_tags!inner(') : CONTACT_SELECT)
    .eq('workspace_id', workspaceId)
  const email = sp.get('email')
  if (email) q = q.ilike('email', email.replace(/[%_]/g, '\\$&'))
  const search = sp.get('q')?.trim()
  if (search) q = q.ilike('name', `%${search.replace(/[%_,()]/g, ' ').slice(0, 100)}%`)
  if (tagId) q = q.eq('contact_tags.tag_id', tagId)
  const since = parseIsoParam(sp.get('updated_since'))
  if (since) q = q.gte('updated_at', since)
  const page = await listPage<Record<string, unknown> & { id: string }>(q, 'created_at', url)
  return { data: page.data.map(serializeContact), next_cursor: page.next_cursor }
}

export async function getContactRow(workspaceId: string, id: string) {
  if (!isUuidLike(id)) throw notFound('Contact')
  const { data } = await supabaseAdmin().from('contacts').select(CONTACT_SELECT).eq('id', id).eq('workspace_id', workspaceId).maybeSingle()
  if (!data) throw notFound('Contact')
  return data
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
  const { data, error } = await supabaseAdmin()
    .from('contacts')
    .insert({ workspace_id: workspaceId, name: fields.name ?? fields.phone ?? fields.email, ...fields })
    .select('id')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'contact insert failed')
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
  const { error } = await supabaseAdmin().from('contacts').update(fields).eq('id', id).eq('workspace_id', workspaceId)
  if (error) throw new Error(error.message)
  return getContact(workspaceId, id)
}

// ------------------------------------------------------------
// Tags
// ------------------------------------------------------------
export async function listTags(workspaceId: string) {
  const { data } = await supabaseAdmin().from('tags').select('id, name, color').eq('workspace_id', workspaceId).order('name')
  return { data: (data ?? []).map(serializeTag) }
}

const TAG_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b']

/** Attaches a tag (by id, or by name — created when missing). */
export async function addTag(workspaceId: string, contactId: string, input: { tag_id?: string | null; name?: string | null; color?: string | null }) {
  const db = supabaseAdmin()
  let tag: { id: string; name: string; color: string } | null = null
  if (input.tag_id) {
    if (!isUuidLike(input.tag_id)) throw badRequest('tag_id must be an id (UUID).', { field: 'tag_id' })
    const { data } = await db.from('tags').select('id, name, color').eq('id', input.tag_id).eq('workspace_id', workspaceId).maybeSingle()
    if (!data) throw notFound('Tag')
    tag = data
  } else if (input.name?.trim()) {
    const name = input.name.trim().slice(0, 50)
    const { data: existing } = await db.from('tags').select('id, name, color').eq('workspace_id', workspaceId).ilike('name', name.replace(/[%_]/g, '\\$&')).limit(1).maybeSingle()
    tag = existing
    if (!tag) {
      const color = input.color && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)]
      const { data: created, error } = await db.from('tags').insert({ workspace_id: workspaceId, name, color }).select('id, name, color').single()
      if (error || !created) throw new Error(error?.message ?? 'tag insert failed')
      tag = created
    }
  } else {
    throw badRequest('Send tag_id or name.')
  }
  const { data: link } = await db.from('contact_tags').select('id').eq('contact_id', contactId).eq('tag_id', tag!.id).maybeSingle()
  if (!link) {
    const { error } = await db.from('contact_tags').insert({ workspace_id: workspaceId, contact_id: contactId, tag_id: tag!.id })
    if (error && error.code !== '23505') throw new Error(error.message)
  }
  return serializeTag(tag!)
}

export async function contactTags(workspaceId: string, contactId: string) {
  return { data: serializeContact(await getContactRow(workspaceId, contactId)).tags }
}

export async function removeTag(workspaceId: string, contactId: string, tagId: string) {
  await getContactRow(workspaceId, contactId)
  if (!isUuidLike(tagId)) throw notFound('Tag')
  await supabaseAdmin().from('contact_tags').delete().eq('workspace_id', workspaceId).eq('contact_id', contactId).eq('tag_id', tagId)
  return { deleted: true }
}
