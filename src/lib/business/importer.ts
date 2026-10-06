import 'server-only'
import { NextResponse } from 'next/server'
import { getPreset, industryLabel } from '@/lib/industries'
import { completeJson, LlmUnavailableError, parseJsonLoose } from '@/lib/ai/llm'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Workspace } from '@/lib/workspace/types'

// AI-assisted bulk import of services and FAQs, phrased with the
// workspace's own industry nouns and currency.

export const MAX_SERVICES = 60
export const MAX_FAQS = 50
export const MAX_TEXT = 30_000

export interface ImportedService {
  name: string
  description: string
  category: string
  price: number
  price_is_from: boolean
  duration_minutes: number
}

export interface ImportedFaq {
  question: string
  answer: string
  keywords: string
}

function businessLine(ws: Workspace) {
  const loc = ws.locale === 'en' ? 'en' : 'es'
  const preset = getPreset(ws.industry)
  const kind = ws.business_type_detail ? `${preset.name.en} (${ws.business_type_detail})` : preset.name.en
  return { loc, preset, kind }
}

export function servicesPrompt(ws: Workspace): string {
  const { loc, kind } = businessLine(ws)
  const service = industryLabel(ws.industry, 'service', 'en', ws.settings)
  const services = industryLabel(ws.industry, 'servicePlural', 'en', ws.settings)
  return `You are a data extraction assistant for "${ws.name}", a business of type: ${kind}.
The business calls what it sells "${services}" (singular "${service}").
Analyze the raw text (copied from a price list, menu, Excel, Word or PDF) and extract a clean list of ${services.toLowerCase()}.

For each item extract:
- "name": item name.
- "description": short description under 120 characters ("" if none).
- "category": group/section it belongs to if the text has one ("" if none).
- "price": number in ${ws.currency}, digits only (no symbols or thousand separators). 0 if not stated.
- "price_is_from": true when the price is a starting price ("from", "desde", "a partir de", ranges), else false.
- "duration_minutes": integer duration in minutes; 30 if not stated.

Keep the original language of the text (the business works in ${loc === 'es' ? 'Spanish' : 'English'}). Never invent items.
Return at most ${MAX_SERVICES} items as JSON: {"services":[...]}. If nothing is found return {"services":[]}.`
}

export function faqsPrompt(ws: Workspace): string {
  const { loc, kind } = businessLine(ws)
  const customer = industryLabel(ws.industry, 'customer', 'en', ws.settings)
  return `You are a data extraction assistant for "${ws.name}", a business of type: ${kind}.
Analyze the provided content and extract Frequently Asked Questions a ${customer.toLowerCase()} might ask, with the business's answer.

For each FAQ extract:
- "question": the question as a ${customer.toLowerCase()} would ask it.
- "answer": the business's answer, clear and under 300 characters. Amounts are in ${ws.currency}.
- "keywords": 3-5 comma-separated trigger keywords.

Keep the original language of the content (the business works in ${loc === 'es' ? 'Spanish' : 'English'}). Never invent answers that are not in the content.
Return at most ${MAX_FAQS} items as JSON: {"faqs":[...]}. If nothing is found return {"faqs":[]}.`
}

export const SERVICES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    services: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
          category: { type: 'STRING' },
          price: { type: 'NUMBER' },
          price_is_from: { type: 'BOOLEAN' },
          duration_minutes: { type: 'INTEGER' },
        },
        required: ['name'],
      },
    },
  },
  required: ['services'],
}

export const FAQS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    faqs: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          question: { type: 'STRING' },
          answer: { type: 'STRING' },
          keywords: { type: 'STRING' },
        },
        required: ['question', 'answer'],
      },
    },
  },
  required: ['faqs'],
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

function num(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (typeof v === 'string') {
    const n = Number(v.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : 0
  }
  return 0
}

/** Accepts the old clinic field names too (service_name, starting_price, duration). */
export function normalizeServices(raw: unknown): ImportedService[] {
  if (!Array.isArray(raw)) return []
  const out: ImportedService[] = []
  for (const r of raw.slice(0, MAX_SERVICES)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const name = str(o.name ?? o.service_name, 160)
    if (!name) continue
    const duration = Math.round(num(o.duration_minutes ?? o.duration))
    out.push({
      name,
      description: str(o.description, 1000),
      category: str(o.category, 80),
      price: Math.max(0, num(o.price ?? o.starting_price)),
      price_is_from: o.price_is_from === true,
      duration_minutes: duration >= 5 && duration <= 1440 ? duration : 30,
    })
  }
  return out
}

export function normalizeFaqs(raw: unknown): ImportedFaq[] {
  if (!Array.isArray(raw)) return []
  const out: ImportedFaq[] = []
  for (const r of raw.slice(0, MAX_FAQS)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const question = str(o.question, 300)
    const answer = str(o.answer, 2000)
    if (!question || !answer) continue
    out.push({ question, answer, keywords: str(o.keywords, 300) })
  }
  return out
}

/** Runs the extraction model; returns the parsed list under `key`. */
export async function extract(system: string, content: string, schema: Record<string, unknown>, key: 'services' | 'faqs') {
  const text = await completeJson({
    system,
    turns: [{ role: 'user', content: content.slice(0, MAX_TEXT) }],
    schema,
    temperature: 0.1,
    timeoutMs: 40_000,
  })
  const parsed = parseJsonLoose<Record<string, unknown>>(text)
  return parsed?.[key] ?? []
}

export function importError(err: unknown) {
  if (err instanceof LlmUnavailableError) {
    return NextResponse.json({ error: 'IA no disponible: un administrador de la plataforma debe configurar un proveedor de IA (Panel de administración → Configuración).' }, { status: 503 })
  }
  const aborted = err instanceof Error && err.name === 'AbortError'
  console.error('[business import]', err)
  return NextResponse.json(
    { error: aborted ? 'The AI took too long to answer. Try with less text.' : 'Could not analyze the content.' },
    { status: aborted ? 504 : 500 },
  )
}

export async function saveServices(workspaceId: string, items: ImportedService[]) {
  if (items.length === 0) return 0
  const { data, error } = await supabaseAdmin()
    .from('services')
    .insert(items.map((s) => ({ ...s, description: s.description || null, category: s.category || null, is_active: true, workspace_id: workspaceId })))
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}

export async function saveFaqs(workspaceId: string, items: ImportedFaq[]) {
  if (items.length === 0) return 0
  const { data, error } = await supabaseAdmin()
    .from('faqs')
    .insert(items.map((f) => ({ ...f, keywords: f.keywords || null, workspace_id: workspaceId })))
    .select('id')
  if (error) throw new Error(error.message)
  return data?.length ?? 0
}
