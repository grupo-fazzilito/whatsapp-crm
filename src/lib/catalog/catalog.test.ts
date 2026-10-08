import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { productAttributesFor, validateAttributes } from './attributes'
import { buildSystemPrompt } from '@/lib/ai/prompt'
import type { BusinessContext, CatalogProduct } from '@/lib/ai/context'
import type { AiAgentRow } from '@/lib/ai/types'

describe('productAttributesFor', () => {
  it('merges preset fields with workspace extras (workspace wins on same key)', () => {
    const fields = productAttributesFor('real_estate', {
      product_attributes: [
        { key: 'pool', type: 'boolean', label: { es: 'Piscina', en: 'Pool' } },
        { key: 'zone', type: 'select', label: { es: 'Distrito', en: 'District' }, options: [{ value: 'Miraflores', label: { es: 'Miraflores', en: 'Miraflores' } }] },
        { key: 'BAD KEY', type: 'text', label: { es: 'x', en: 'x' } },
      ],
    })
    expect(fields.map((f) => f.key)).toContain('pool')
    expect(fields.find((f) => f.key === 'zone')?.type).toBe('select')
    expect(fields.some((f) => f.key === 'BAD KEY')).toBe(false)
  })
})

describe('validateAttributes', () => {
  const fields = productAttributesFor('real_estate', null)
  it('coerces types and maps option labels to values', () => {
    const { values, errors } = validateAttributes(fields, {
      operation: 'Alquiler',
      bedrooms: '3',
      area_m2: '85,5',
      zone: 'Miraflores',
      unknown: 'dropped',
    })
    expect(errors).toEqual({})
    expect(values).toEqual({ operation: 'rent', bedrooms: 3, area_m2: 85.5, zone: 'Miraflores' })
  })
  it('reports required, numeric and option errors', () => {
    const { errors } = validateAttributes(fields, { bedrooms: 'muchas', property_type: 'castillo' })
    expect(errors).toMatchObject({ operation: 'required', bedrooms: 'number', property_type: 'option' })
  })
  it('handles multiselect and booleans (restaurant menu)', () => {
    const menu = productAttributesFor('restaurant', null)
    const { values, errors } = validateAttributes(menu, { allergens: 'Gluten, lácteos', vegetarian: 'sí' })
    expect(errors).toEqual({})
    expect(values).toMatchObject({ allergens: ['gluten', 'dairy'], vegetarian: true })
  })
})

const product = (over: Partial<CatalogProduct>): CatalogProduct => ({
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Depa en Miraflores',
  description: null,
  price: 2800,
  category_id: null,
  stock: null,
  track_stock: false,
  images: ['https://cdn/x.jpg'],
  attributes: { operation: 'rent', bedrooms: 2 },
  is_featured: false,
  ...over,
})

function ctx(products: CatalogProduct[] | null, total: number): BusinessContext {
  return {
    workspace: {
      id: 'ws',
      name: 'Inmo',
      industry: 'real_estate',
      currency: 'PEN',
      timezone: 'America/Lima',
      locale: 'es',
      settings: {},
      date_exceptions: [],
    } as unknown as BusinessContext['workspace'],
    timeZone: 'America/Lima',
    hours: [],
    exceptions: [],
    staff: [],
    services: [],
    faqs: [],
    agents: [],
    bookings: [],
    catalog: { categories: [], total, products },
  }
}

const agent = { id: 'a1', name: 'Leo', skills: ['catalog'], tone: 'friendly', language: 'auto', transfer_agent_ids: [] } as unknown as AiAgentRow
const base = { agent, transferTargets: [], draft: null, customerBookings: [], customerName: null, channelLabel: 'WhatsApp' }

describe('catalog section of the agent prompt', () => {
  it('lists a small catalog with prices in the workspace currency', () => {
    const prompt = buildSystemPrompt({ ...base, ctx: ctx([product({})], 1) })
    expect(prompt).toContain('FULL CATALOG')
    expect(prompt).toContain('Depa en Miraflores')
    expect(prompt).toMatch(/S\/|PEN/)
    expect(prompt).toContain('operation=rent')
  })
  it('asks for catalog_search when the catalog is large', () => {
    const prompt = buildSystemPrompt({ ...base, ctx: ctx(null, 500) })
    expect(prompt).toContain('set catalog_search')
    expect(prompt).not.toContain('FULL CATALOG')
  })
  it('includes search results and marks out-of-stock items', () => {
    const prompt = buildSystemPrompt({
      ...base,
      ctx: ctx(null, 500),
      catalogResults: { query: 'depa 2 recamaras', products: [product({ track_stock: true, stock: 0 })] },
    })
    expect(prompt).toContain('SEARCH RESULTS for "depa 2 recamaras"')
    expect(prompt).toContain('OUT OF STOCK')
    expect(prompt).toContain('do NOT set catalog_search again')
  })
})

describe('per-product currency in the agent prompt', () => {
  const ws = { ...ctx(null, 0).workspace, country: 'PE' } as BusinessContext['workspace']
  const sale = product({ id: '00000000-0000-0000-0000-0000000000aa', name: 'Casa en La Molina', price: 350000, currency: 'USD', attributes: { operation: 'sale' } })
  const rent = product({ id: '00000000-0000-0000-0000-0000000000bb', name: 'Depa en Surco', price: 2800, currency: null })
  it('shows each listing with its own currency', () => {
    const c = { ...ctx([sale, rent], 2), workspace: ws }
    const prompt = buildSystemPrompt({ ...base, ctx: c }).replace(/\s/g, ' ')
    expect(prompt).toContain('Casa en La Molina: US$ 350,000.00')
    expect(prompt).toContain('Depa en Surco: S/ 2,800.00')
    expect(prompt).toContain('never convert between currencies')
  })
  it('search results keep the product currency', () => {
    const c = { ...ctx(null, 500), workspace: ws }
    const prompt = buildSystemPrompt({ ...base, ctx: c, catalogResults: { query: 'casa', products: [sale] } }).replace(/\s/g, ' ')
    expect(prompt).toContain('[00000000-0000-0000-0000-0000000000aa] Casa en La Molina: US$ 350,000.00')
    // Large catalog: the model is told to pass the budget currency.
    expect(buildSystemPrompt({ ...base, ctx: c })).toContain('currency="USD"')
  })
})
