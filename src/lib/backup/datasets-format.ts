// Rows of the full business backup (contacts, products, automations,
// templates) and the ZIP's file names and read-me. Pure: no database.
import { csvEscape, type CsvCell } from '@/lib/reports/csv'
import { TEMPLATE_HEADERS } from '@/lib/catalog/import'
import { localDate, type BackupLang } from './messages-format'

import { DATASETS, type Dataset } from './datasets-list'

export { DATASETS, type Dataset }

/** "conversations,contacts" → the datasets in canonical order; null if any is unknown or none given. */
export function parseDatasets(v: string | null): Dataset[] | null {
  if (v === null) return [...DATASETS]
  const asked = v.split(',').map((s) => s.trim()).filter(Boolean)
  if (!asked.length || asked.some((s) => !(DATASETS as readonly string[]).includes(s))) return null
  return DATASETS.filter((d) => asked.includes(d))
}

const YES_NO = { es: ['Sí', 'No'], en: ['Yes', 'No'] } as const
const yesNo = (b: boolean | null | undefined, lang: BackupLang) => (b ? YES_NO[lang][0] : YES_NO[lang][1])

/** One CSV line (CRLF). */
export function csvLine(cells: readonly CsvCell[]): string {
  return `${cells.map(csvEscape).join(',')}\r\n`
}
export const BOM = '﻿'

/** Rows read through Prisma carry timestamps as ISO strings; raw SQL as Date. */
export type When = Date | string | null

const asDate = (d: When): Date | null => (d === null ? null : d instanceof Date ? d : new Date(d))
const local = (d: When, timeZone: string) => localDate(asDate(d), timeZone)
const iso = (d: When) => asDate(d)?.toISOString() ?? null

const num = (v: { toString(): string } | number | null | undefined): number | null => {
  if (v === null || v === undefined) return null
  const n = typeof v === 'number' ? v : Number(v.toString())
  return Number.isFinite(n) ? n : null
}

// ------------------------------------------------------------------
// Contacts
// ------------------------------------------------------------------

export interface BackupContact {
  id: string
  name: string | null
  phone: string | null
  email: string | null
  company: string | null
  created_at: When
  tags: string[]
  /** Channel types the contact has written from (whatsapp, instagram…). */
  channels: string[]
  /** custom_field_id → value */
  custom: Record<string, string | null>
}

export interface CustomFieldColumn {
  id: string
  field_name: string
}

const CONTACT_TEXT = {
  es: { before: ['Nombre', 'Teléfono', 'Correo', 'Empresa', 'Etiquetas', 'Canales'], after: ['Creado', 'ID'] },
  en: { before: ['Name', 'Phone', 'Email', 'Company', 'Tags', 'Channels'], after: ['Created', 'ID'] },
}

export function contactsHeader(lang: BackupLang, fields: CustomFieldColumn[]): string[] {
  const t = CONTACT_TEXT[lang]
  return [...t.before, ...fields.map((f) => f.field_name), ...t.after]
}

export function contactRow(c: BackupContact, fields: CustomFieldColumn[], o: { timeZone: string }): CsvCell[] {
  return [
    c.name,
    c.phone,
    c.email,
    c.company,
    c.tags.join(' | '),
    [...new Set(c.channels)].join(' | '),
    ...fields.map((f) => c.custom[f.id] ?? null),
    local(c.created_at, o.timeZone),
    c.id,
  ]
}

// ------------------------------------------------------------------
// Products — columns named like the catalog importer's template, so the
// file can be uploaded again in Catálogo → Importar.
// ------------------------------------------------------------------

type Money = { toString(): string } | number | null

export interface BackupProduct {
  name: string
  description: string | null
  price: Money
  currency: string | null
  compare_at_price: Money
  sku: string | null
  stock: number | null
  category: string | null
  images: string[]
  tags: string[]
  is_featured: boolean
  is_active: boolean
  attributes: unknown
  variants_count: number
  created_at: When
}

const PRODUCT_EXTRA = { es: ['variantes', 'creado'], en: ['variants', 'created'] }
const FIXED_ORDER = ['name', 'description', 'price', 'currency', 'compare_at_price', 'sku', 'stock', 'category', 'images', 'tags', 'is_featured', 'is_active'] as const

/** Importer headers, then one column per attribute key, then extras the importer ignores. */
export function productsHeader(lang: BackupLang, attributeKeys: string[]): string[] {
  const h = TEMPLATE_HEADERS[lang]
  return [...FIXED_ORDER.map((k) => h[k]), ...attributeKeys, ...PRODUCT_EXTRA[lang]]
}

function attributeCell(v: unknown, lang: BackupLang): CsvCell {
  if (v === null || v === undefined) return null
  if (Array.isArray(v)) return v.map(String).join(', ')
  if (typeof v === 'boolean') return yesNo(v, lang)
  if (typeof v === 'number') return v
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export function productRow(p: BackupProduct, attributeKeys: string[], o: { lang: BackupLang; timeZone: string }): CsvCell[] {
  const attrs = p.attributes && typeof p.attributes === 'object' && !Array.isArray(p.attributes) ? (p.attributes as Record<string, unknown>) : {}
  return [
    p.name,
    p.description,
    num(p.price),
    p.currency,
    num(p.compare_at_price),
    p.sku,
    p.stock,
    p.category,
    p.images.join(' | '),
    p.tags.join(' | '),
    yesNo(p.is_featured, o.lang),
    yesNo(p.is_active, o.lang),
    ...attributeKeys.map((k) => attributeCell(attrs[k], o.lang)),
    p.variants_count,
    local(p.created_at, o.timeZone),
  ]
}

export interface BackupVariant {
  product_name: string
  product_sku: string | null
  name: string
  options: unknown
  sku: string | null
  price: Money
  stock: number | null
  weight_kg: Money
  is_active: boolean
}

const VARIANT_TEXT = {
  es: ['Producto', 'SKU del producto', 'Variante', 'Opciones', 'SKU', 'Precio', 'Stock', 'Peso (kg)', 'Activa'],
  en: ['Product', 'Product SKU', 'Variant', 'Options', 'SKU', 'Price', 'Stock', 'Weight (kg)', 'Active'],
}

export function variantsHeader(lang: BackupLang): string[] {
  return VARIANT_TEXT[lang]
}

/** {"Talla":"M","Color":"Rojo"} → "Talla: M | Color: Rojo" */
export function optionsText(options: unknown): string {
  if (!options || typeof options !== 'object' || Array.isArray(options)) return ''
  return Object.entries(options as Record<string, unknown>)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : String(v)}`)
    .join(' | ')
}

export function variantRow(v: BackupVariant, lang: BackupLang): CsvCell[] {
  return [v.product_name, v.product_sku, v.name, optionsText(v.options), v.sku, num(v.price), v.stock, num(v.weight_kg), yesNo(v.is_active, lang)]
}

// ------------------------------------------------------------------
// Automations
// ------------------------------------------------------------------

export interface BackupAutomationStep {
  id: string
  parent_step_id: string | null
  branch: string | null
  step_type: string
  step_config: unknown
  position: number
}

export interface BackupAutomation {
  id: string
  name: string
  description: string | null
  trigger_type: string
  trigger_config: unknown
  is_active: boolean
  execution_count: number
  last_executed_at: When
  created_at: When
  updated_at: When
  steps: BackupAutomationStep[]
}

/** The full definitions, ready to be restored later (steps flat, linked by parent_step_id). */
export function automationsJson(list: BackupAutomation[], generatedAt: Date): string {
  return `${JSON.stringify(
    {
      format: 'whasalia.automations',
      version: 1,
      generated_at: generatedAt.toISOString(),
      automations: list.map((a) => ({
        id: a.id,
        name: a.name,
        description: a.description,
        trigger_type: a.trigger_type,
        trigger_config: a.trigger_config,
        is_active: a.is_active,
        execution_count: a.execution_count,
        last_executed_at: iso(a.last_executed_at),
        created_at: iso(a.created_at),
        updated_at: iso(a.updated_at),
        steps: [...a.steps]
          .sort((x, y) => x.position - y.position)
          .map((s) => ({ id: s.id, parent_step_id: s.parent_step_id, branch: s.branch, step_type: s.step_type, step_config: s.step_config, position: s.position })),
      })),
    },
    null,
    2,
  )}\n`
}

const AUTOMATION_TEXT = {
  es: ['Nombre', 'Descripción', 'Disparador', 'Activa', 'Pasos', 'Ejecuciones', 'Última ejecución', 'Creada'],
  en: ['Name', 'Description', 'Trigger', 'Active', 'Steps', 'Runs', 'Last run', 'Created'],
}

export function automationsHeader(lang: BackupLang): string[] {
  return AUTOMATION_TEXT[lang]
}

export function automationRow(a: BackupAutomation, o: { lang: BackupLang; timeZone: string }): CsvCell[] {
  return [a.name, a.description, a.trigger_type, yesNo(a.is_active, o.lang), a.steps.length, a.execution_count, local(a.last_executed_at, o.timeZone), local(a.created_at, o.timeZone)]
}

// ------------------------------------------------------------------
// WhatsApp templates
// ------------------------------------------------------------------

export interface BackupTemplate {
  name: string
  category: string
  language: string | null
  status: string | null
  header_type: string | null
  header_content: string | null
  header_media_url: string | null
  body_text: string
  footer_text: string | null
  buttons: unknown
  meta_template_id: string | null
  rejection_reason: string | null
  created_at: When
}

const TEMPLATE_TEXT = {
  es: ['Nombre', 'Categoría', 'Idioma', 'Estado', 'Tipo de encabezado', 'Encabezado', 'Archivo del encabezado', 'Cuerpo', 'Pie', 'Botones', 'ID en Meta', 'Motivo de rechazo', 'Creada'],
  en: ['Name', 'Category', 'Language', 'Status', 'Header type', 'Header', 'Header file', 'Body', 'Footer', 'Buttons', 'Meta ID', 'Rejection reason', 'Created'],
}

export function templatesHeader(lang: BackupLang): string[] {
  return TEMPLATE_TEXT[lang]
}

/** [{type:'url', text:'Ver', value:'https://…'}] → "url: Ver: https://…" (joined " | "). Accepts Meta's shape too. */
export function buttonsText(buttons: unknown): string {
  if (!Array.isArray(buttons)) return ''
  return buttons
    .filter((b): b is Record<string, unknown> => !!b && typeof b === 'object')
    .map((b) => {
      const value = b.value ?? b.url ?? b.phone_number ?? b.phone ?? null
      return [b.type, b.text, value].filter((x) => x !== null && x !== undefined && String(x) !== '').map(String).join(': ')
    })
    .filter(Boolean)
    .join(' | ')
}

export function templateRow(t: BackupTemplate, o: { timeZone: string }): CsvCell[] {
  return [
    t.name,
    t.category,
    t.language,
    t.status,
    t.header_type,
    t.header_content,
    t.header_media_url,
    t.body_text,
    t.footer_text,
    buttonsText(t.buttons),
    t.meta_template_id,
    t.rejection_reason,
    local(t.created_at, o.timeZone),
  ]
}

// ------------------------------------------------------------------
// ZIP: file names and read-me
// ------------------------------------------------------------------

export const FILE_NAMES = {
  es: {
    conversations: 'conversaciones.csv',
    contacts: 'contactos.csv',
    products: 'productos.csv',
    variants: 'productos-variantes.csv',
    automationsJson: 'automatizaciones.json',
    automationsCsv: 'automatizaciones.csv',
    templates: 'plantillas.csv',
    readme: 'LEEME.txt',
  },
  en: {
    conversations: 'conversations.csv',
    contacts: 'contacts.csv',
    products: 'products.csv',
    variants: 'product-variants.csv',
    automationsJson: 'automations.json',
    automationsCsv: 'automations.csv',
    templates: 'templates.csv',
    readme: 'README.txt',
  },
} as const

/** respaldo-whasalia-2026-11-27.zip */
export function zipFileName(lang: BackupLang, day: string): string {
  return `${lang === 'en' ? 'whasalia-backup' : 'respaldo-whasalia'}-${day}.zip`
}

/** "2026-11-27" in the business's time zone. */
export function localDay(d: Date, timeZone: string): string {
  return localDate(d, timeZone).slice(0, 10)
}

const README = {
  es: {
    title: 'Respaldo de Whasalia',
    generated: 'Generado',
    tz: 'Zona horaria de las fechas',
    range: 'Conversaciones desde / hasta',
    all: 'todo el historial',
    internal: 'Notas internas incluidas',
    files: 'Archivos',
    csvNote: 'Los archivos CSV están en UTF-8 y se abren en Excel o Google Sheets. Los valores que empiezan con =, +, - o @ llevan un apóstrofo delante para que la hoja no los ejecute como fórmulas.',
    desc: {
      conversations: 'Una fila por mensaje, del más antiguo al más reciente: fecha, conversación, canal, contacto, quién escribió y el texto. Los archivos (fotos, audios, documentos) van como enlace; para abrirlos hay que haber iniciado sesión.',
      contacts: 'Un contacto por fila: nombre, teléfono, correo, empresa, etiquetas (separadas por " | "), canales, una columna por cada campo personalizado y la fecha de creación.',
      products: 'Un producto por fila, con las mismas columnas que la plantilla de Catálogo → Importar: puedes volver a subir este archivo para restaurar o copiar tu catálogo (las columnas "variantes" y "creado" se ignoran al importar). Imágenes y etiquetas van separadas por " | ".',
      variants: 'Una fila por variante (talla, color…) con su producto, opciones, SKU, precio y stock.',
      automationsJson: 'La definición completa de cada automatización (disparador, configuración, pasos y si está activa), para poder restaurarlas más adelante. Puede incluir datos que configuraste en pasos de webhook (direcciones y cabeceras): guárdalo en un lugar seguro.',
      automationsCsv: 'Resumen de las automatizaciones: nombre, disparador, si está activa, cantidad de pasos y fechas.',
      templates: 'Plantillas de WhatsApp: nombre, categoría, idioma, estado, encabezado, cuerpo, pie, botones (tipo: texto: valor, separados por " | "), ID en Meta y motivo de rechazo.',
    },
    yes: 'sí',
    no: 'no',
  },
  en: {
    title: 'Whasalia backup',
    generated: 'Generated',
    tz: 'Time zone of the dates',
    range: 'Conversations from / to',
    all: 'whole history',
    internal: 'Internal notes included',
    files: 'Files',
    csvNote: 'The CSV files are UTF-8 and open in Excel or Google Sheets. Values that start with =, +, - or @ get a leading apostrophe so the spreadsheet never runs them as formulas.',
    desc: {
      conversations: 'One row per message, oldest first: date, conversation, channel, contact, who wrote it and the text. Files (photos, audio, documents) are links; opening them requires being signed in.',
      contacts: 'One contact per row: name, phone, email, company, tags (separated by " | "), channels, one column per custom field and the creation date.',
      products: 'One product per row, with the same columns as the Catalog → Import template: you can upload this file again to restore or copy your catalog (the "variants" and "created" columns are ignored on import). Images and tags are separated by " | ".',
      variants: 'One row per variant (size, colour…) with its product, options, SKU, price and stock.',
      automationsJson: 'The full definition of every automation (trigger, settings, steps and whether it is active), so they can be restored later. It may include data you set in webhook steps (addresses and headers): keep it somewhere safe.',
      automationsCsv: 'Summary of the automations: name, trigger, whether it is active, number of steps and dates.',
      templates: 'WhatsApp templates: name, category, language, status, header, body, footer, buttons (type: text: value, separated by " | "), Meta ID and rejection reason.',
    },
    yes: 'yes',
    no: 'no',
  },
}

export function readmeText(o: {
  lang: BackupLang
  datasets: Dataset[]
  generatedAt: Date
  timeZone: string
  from: string | null
  to: string | null
  includeInternal: boolean
}): string {
  const t = README[o.lang]
  const f = FILE_NAMES[o.lang]
  const lines = [t.title, '='.repeat(t.title.length), '', `${t.generated}: ${localDate(o.generatedAt, o.timeZone)}`, `${t.tz}: ${o.timeZone}`]
  if (o.datasets.includes('conversations')) {
    lines.push(`${t.range}: ${o.from || o.to ? `${o.from ?? '…'} / ${o.to ?? '…'}` : t.all}`)
    lines.push(`${t.internal}: ${o.includeInternal ? t.yes : t.no}`)
  }
  lines.push('', `${t.files}:`, '')
  const add = (name: string, desc: string) => lines.push(`- ${name}`, `  ${desc}`, '')
  for (const d of o.datasets) {
    if (d === 'conversations') add(f.conversations, t.desc.conversations)
    if (d === 'contacts') add(f.contacts, t.desc.contacts)
    if (d === 'products') {
      add(f.products, t.desc.products)
      add(f.variants, t.desc.variants)
    }
    if (d === 'automations') {
      add(f.automationsJson, t.desc.automationsJson)
      add(f.automationsCsv, t.desc.automationsCsv)
    }
    if (d === 'templates') add(f.templates, t.desc.templates)
  }
  lines.push(t.csvNote, '')
  return lines.join('\r\n')
}
