import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { completeJson, LlmUnavailableError, parseJsonLoose } from '@/lib/ai/llm'
import { getPreset, industryLabel, type AttributeField } from '@/lib/industries'
import { productAttributesFor } from '@/lib/catalog/attributes'
import type { Workspace } from '@/lib/workspace/types'

const MAX_TEXT = 30_000
const MAX_ITEMS = 150

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    products: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          description: { type: 'STRING' },
          price: { type: 'NUMBER', nullable: true },
          currency: { type: 'STRING' },
          category: { type: 'STRING' },
          sku: { type: 'STRING' },
          attributes: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: { key: { type: 'STRING' }, value: { type: 'STRING' } },
              required: ['key', 'value'],
            },
          },
        },
        required: ['name'],
      },
    },
  },
  required: ['products'],
}

function fieldLine(f: AttributeField): string {
  let kind: string = f.type
  if (f.type === 'boolean') kind = 'boolean ("true" or "false")'
  if (f.type === 'number') kind = `number${f.unit ? ` in ${f.unit}` : ''} (digits only)`
  if (f.options?.length) {
    const opts = f.options.map((o) => `"${o.value}" (${o.label.es} / ${o.label.en})`).join(', ')
    kind = f.type === 'multiselect' ? `list of comma-separated values from: ${opts}` : `one of: ${opts}`
  }
  return `- "${f.key}" — ${f.label.en} / ${f.label.es}: ${kind}`
}

function prompt(ws: Workspace, fields: AttributeField[]): string {
  const preset = getPreset(ws.industry)
  const kind = ws.business_type_detail ? `${preset.name.en} (${ws.business_type_detail})` : preset.name.en
  const products = industryLabel(ws.industry, 'productPlural', 'en', ws.settings)
  const product = industryLabel(ws.industry, 'product', 'en', ws.settings)
  return `You are a data extraction assistant for "${ws.name}", a business of type: ${kind}.
The business calls its catalog items "${products}" (singular "${product}").
Analyze the raw text (a WhatsApp menu, price list, listing sheet, spreadsheet copy...) and extract one entry per ${product.toLowerCase()}.

For each item extract:
- "name": item name.
- "description": short description ("" if none).
- "price": number, digits only (no symbols or thousand separators). null when no price is stated.
- "currency": ISO 4217 code of that price ONLY when the text states a currency other than ${ws.currency} (e.g. "US$ 350,000" → "USD"); "" otherwise.
- "category": the section/group it belongs to if the text has one ("" if none).
- "sku": code/reference only if the text shows one ("" otherwise).
- "attributes": list of {"key","value"} using ONLY these keys (omit those the text does not state):
${fields.length ? fields.map(fieldLine).join('\n') : '(no attributes for this business — return an empty list)'}

Keep the original language of the text (the business works in ${ws.locale === 'en' ? 'English' : 'Spanish'}). Never invent items, prices or attributes.
Return at most ${MAX_ITEMS} items as JSON: {"products":[...]}. If nothing is found return {"products":[]}.`
}

interface Extracted {
  name?: unknown
  description?: unknown
  price?: unknown
  currency?: unknown
  category?: unknown
  sku?: unknown
  attributes?: unknown
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/**
 * POST { text } → { rows: RawRecord[] } — AI-extracted products for the
 * import preview. Nothing is written.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace

  const body = (await request.json().catch(() => null)) as { text?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Text to analyze is required' }, { status: 400 })
  if (text.length > MAX_TEXT) return NextResponse.json({ error: `Text is too long (max ${MAX_TEXT} characters)` }, { status: 400 })

  const fields = productAttributesFor(ws.industry, ws.settings)
  const keys = new Set(fields.map((f) => f.key))
  try {
    const raw = await completeJson({
      meter: { workspaceId: ws.id, purpose: 'import' },
      system: prompt(ws, fields),
      turns: [{ role: 'user', content: text }],
      schema: SCHEMA,
      temperature: 0.1,
      timeoutMs: 60_000,
    })
    const parsed = parseJsonLoose<{ products?: Extracted[] }>(raw)
    const list = Array.isArray(parsed?.products) ? parsed.products.slice(0, MAX_ITEMS) : []
    const rows = list
      .filter((p) => p && typeof p === 'object' && str(p.name))
      .map((p) => {
        const attributes: Record<string, string> = {}
        if (Array.isArray(p.attributes)) {
          for (const a of p.attributes as { key?: unknown; value?: unknown }[]) {
            const key = str(a?.key)
            const value = str(a?.value)
            if (keys.has(key) && value) attributes[key] = value
          }
        }
        return {
          name: str(p.name),
          description: str(p.description) || undefined,
          price: typeof p.price === 'number' || (typeof p.price === 'string' && p.price.trim()) ? p.price : undefined,
          currency: str(p.currency) || undefined,
          category: str(p.category) || undefined,
          sku: str(p.sku) || undefined,
          attributes,
        }
      })
    return NextResponse.json({ rows })
  } catch (err) {
    if (err instanceof LlmUnavailableError) {
      return NextResponse.json(
        { error: 'IA no disponible: un administrador de la plataforma debe configurar un proveedor de IA (Panel de administración → Configuración).' },
        { status: 503 },
      )
    }
    const aborted = err instanceof Error && err.name === 'AbortError'
    console.error('[catalog import ai]', err)
    return NextResponse.json(
      { error: aborted ? 'The AI took too long to answer. Try with less text.' : 'Could not analyze the content.' },
      { status: aborted ? 504 : 500 },
    )
  }
}
