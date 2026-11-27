import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { backupStream } from './messages-csv'
import type { BackupLang } from './messages-format'
import { zipStream, fromStream, type ZipEntry } from './zip'
import {
  BOM,
  FILE_NAMES,
  automationRow,
  automationsHeader,
  automationsJson,
  contactRow,
  contactsHeader,
  csvLine,
  productRow,
  productsHeader,
  readmeText,
  templateRow,
  templatesHeader,
  variantRow,
  variantsHeader,
  type BackupAutomation,
  type Dataset,
} from './datasets-format'

// The full business backup: one ZIP with a file per chosen dataset, built
// while it downloads. Every read goes through tenantDb (or filters by the
// workspace id in raw SQL), so a business only ever gets its own rows.

const BATCH = 1000

export interface FullBackupOptions {
  workspaceId: string
  datasets: Dataset[]
  /** Conversations only. */
  from: Date | null
  to: Date | null
  includeInternal: boolean
  /** As typed (YYYY-MM-DD), for the read-me. */
  fromDay: string | null
  toDay: string | null
  timeZone: string
  lang: BackupLang
  origin: string
  generatedAt?: Date
}

type Db = ReturnType<typeof tenantDb>

function contactBatch(db: Db, after: string | null) {
  return db.contacts.findMany({
    where: after ? { id: { gt: after } } : {},
    orderBy: { id: 'asc' },
    take: BATCH,
    select: {
      id: true,
      name: true,
      phone: true,
      email: true,
      company: true,
      created_at: true,
      contact_tags: { select: { tags: { select: { name: true } } } },
      contact_custom_values: { select: { custom_field_id: true, value: true } },
      contact_identities: { select: { channel_type: true } },
      conversations: { select: { channel_type: true }, distinct: ['channel_type'] },
    },
  })
}

async function* contactsCsv(db: Db, o: FullBackupOptions): AsyncGenerator<string> {
  const fields = await db.custom_fields.findMany({ select: { id: true, field_name: true }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] })
  yield BOM + csvLine(contactsHeader(o.lang, fields))
  let after: string | null = null
  for (;;) {
    const rows = await contactBatch(db, after)
    let chunk = ''
    for (const c of rows) {
      chunk += csvLine(
        contactRow(
          {
            ...c,
            tags: c.contact_tags.map((t) => t.tags.name).sort((a, b) => a.localeCompare(b)),
            channels: [...c.conversations.map((v) => v.channel_type), ...c.contact_identities.map((i) => i.channel_type)].filter((x): x is string => !!x),
            custom: Object.fromEntries(c.contact_custom_values.map((v) => [v.custom_field_id, v.value])),
          },
          fields,
          o,
        ),
      )
    }
    if (chunk) yield chunk
    if (rows.length < BATCH) return
    after = rows[rows.length - 1].id
  }
}

async function attributeKeys(workspaceId: string): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ k: string }[]>`
    SELECT DISTINCT k
      FROM public.products p,
           jsonb_object_keys(CASE WHEN jsonb_typeof(p.attributes) = 'object' THEN p.attributes ELSE '{}'::jsonb END) AS k
     WHERE p.workspace_id = ${workspaceId}::uuid
     ORDER BY k`
  return rows.map((r) => r.k)
}

function productBatch(db: Db, after: string | null) {
  return db.products.findMany({
    where: after ? { id: { gt: after } } : {},
    orderBy: { id: 'asc' },
    take: BATCH,
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      compare_at_price: true,
      sku: true,
      stock: true,
      images: true,
      tags: true,
      is_featured: true,
      is_active: true,
      attributes: true,
      created_at: true,
      product_categories: { select: { name: true } },
      _count: { select: { product_variants: true } },
    },
  })
}

async function* productsCsv(db: Db, o: FullBackupOptions): AsyncGenerator<string> {
  const keys = await attributeKeys(o.workspaceId)
  yield BOM + csvLine(productsHeader(o.lang, keys))
  let after: string | null = null
  for (;;) {
    const rows = await productBatch(db, after)
    let chunk = ''
    for (const p of rows) {
      chunk += csvLine(productRow({ ...p, category: p.product_categories?.name ?? null, variants_count: p._count.product_variants }, keys, o))
    }
    if (chunk) yield chunk
    if (rows.length < BATCH) return
    after = rows[rows.length - 1].id
  }
}

function variantBatch(db: Db, after: string | null) {
  return db.products.findMany({
    where: after ? { id: { gt: after } } : {},
    orderBy: { id: 'asc' },
    take: BATCH,
    select: {
      id: true,
      name: true,
      sku: true,
      product_variants: {
        orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
        select: { name: true, options: true, sku: true, price: true, stock: true, weight_kg: true, is_active: true },
      },
    },
  })
}

async function* variantsCsv(db: Db, o: FullBackupOptions): AsyncGenerator<string> {
  yield BOM + csvLine(variantsHeader(o.lang))
  let after: string | null = null
  for (;;) {
    const products = await variantBatch(db, after)
    let chunk = ''
    for (const p of products) {
      for (const v of p.product_variants) chunk += csvLine(variantRow({ ...v, product_name: p.name, product_sku: p.sku }, o.lang))
    }
    if (chunk) yield chunk
    if (products.length < BATCH) return
    after = products[products.length - 1].id
  }
}

async function loadAutomations(db: Db): Promise<BackupAutomation[]> {
  const rows = await db.automations.findMany({
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      name: true,
      description: true,
      trigger_type: true,
      trigger_config: true,
      is_active: true,
      execution_count: true,
      last_executed_at: true,
      created_at: true,
      updated_at: true,
      automation_steps: {
        orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
        select: { id: true, parent_step_id: true, branch: true, step_type: true, step_config: true, position: true },
      },
    },
  })
  return rows.map(({ automation_steps, ...a }) => ({ ...a, steps: automation_steps }))
}

async function* templatesCsv(db: Db, o: FullBackupOptions): AsyncGenerator<string> {
  const rows = await db.message_templates.findMany({
    orderBy: [{ name: 'asc' }, { language: 'asc' }],
    select: {
      name: true,
      category: true,
      language: true,
      status: true,
      header_type: true,
      header_content: true,
      header_media_url: true,
      body_text: true,
      footer_text: true,
      buttons: true,
      meta_template_id: true,
      rejection_reason: true,
      created_at: true,
    },
  })
  yield BOM + csvLine(templatesHeader(o.lang)) + rows.map((t) => csvLine(templateRow(t, o))).join('')
}

/** The ZIP's entries, in the order they're written. */
export function backupEntries(o: FullBackupOptions): ZipEntry[] {
  const db = tenantDb(o.workspaceId)
  const f = FILE_NAMES[o.lang]
  const generatedAt = o.generatedAt ?? new Date()
  let automations: Promise<BackupAutomation[]> | null = null
  const getAutomations = () => (automations ??= loadAutomations(db))

  const entries: ZipEntry[] = [
    {
      name: f.readme,
      content: async function* () {
        yield readmeText({ ...o, generatedAt, from: o.fromDay, to: o.toDay })
      },
    },
  ]
  for (const d of o.datasets) {
    if (d === 'conversations') {
      entries.push({ name: f.conversations, content: () => fromStream(backupStream(o)) })
    } else if (d === 'contacts') {
      entries.push({ name: f.contacts, content: () => contactsCsv(db, o) })
    } else if (d === 'products') {
      entries.push({ name: f.products, content: () => productsCsv(db, o) })
      entries.push({ name: f.variants, content: () => variantsCsv(db, o) })
    } else if (d === 'automations') {
      entries.push({
        name: f.automationsJson,
        content: async function* () {
          yield automationsJson(await getAutomations(), generatedAt)
        },
      })
      entries.push({
        name: f.automationsCsv,
        content: async function* () {
          const list = await getAutomations()
          yield BOM + csvLine(automationsHeader(o.lang)) + list.map((a) => csvLine(automationRow(a, o))).join('')
        },
      })
    } else if (d === 'templates') {
      entries.push({ name: f.templates, content: () => templatesCsv(db, o) })
    }
  }
  return entries
}

export function backupZipStream(o: FullBackupOptions): ReadableStream<Uint8Array> {
  return zipStream(backupEntries(o), o.generatedAt ?? new Date())
}
