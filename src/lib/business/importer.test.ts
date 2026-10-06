import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: vi.fn() }))
const completeJson = vi.fn()
vi.mock('@/lib/ai/llm', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/llm')>()), completeJson: (...a: unknown[]) => completeJson(...a) }))

import { extract, faqsPrompt, normalizeFaqs, normalizeServices, servicesPrompt, SERVICES_SCHEMA } from './importer'
import type { Workspace } from '@/lib/workspace/types'

const ws = (over: Partial<Workspace> = {}) =>
  ({ id: 'w1', name: 'Barbería Don Pepe', industry: 'barbershop', currency: 'COP', locale: 'es', business_type_detail: null, settings: {}, ...over }) as Workspace

describe('import prompts', () => {
  it('use the industry nouns and the workspace currency, never a hard-coded one', () => {
    const p = servicesPrompt(ws())
    expect(p).toContain('Barbershop')
    expect(p).toContain('COP')
    expect(p).not.toMatch(/₹|clinic|patient/i)
    const r = faqsPrompt(ws({ industry: 'restaurant', currency: 'ARS', settings: { labels: { en: { customer: 'Diner' } } } }))
    expect(r).toContain('Restaurant')
    expect(r).toContain('diner')
    expect(r).toContain('ARS')
  })
})

describe('normalizeServices', () => {
  it('maps new and legacy field names, cleans prices and durations', () => {
    expect(
      normalizeServices([
        { name: ' Corte ', price: '$1,200', duration_minutes: 45, price_is_from: true, category: 'Cabello' },
        { service_name: 'Barba', starting_price: 99.5, duration: 2 },
        { name: '' },
        null,
      ]),
    ).toEqual([
      { name: 'Corte', description: '', category: 'Cabello', price: 1200, price_is_from: true, duration_minutes: 45 },
      { name: 'Barba', description: '', category: '', price: 99.5, price_is_from: false, duration_minutes: 30 },
    ])
    expect(normalizeServices('nope')).toEqual([])
  })
})

describe('normalizeFaqs', () => {
  it('drops incomplete rows', () => {
    expect(normalizeFaqs([{ question: '¿Abren?', answer: 'Sí' }, { question: 'x' }])).toEqual([
      { question: '¿Abren?', answer: 'Sí', keywords: '' },
    ])
  })
})

describe('extract', () => {
  it('calls the shared LLM helper and parses fenced JSON', async () => {
    completeJson.mockResolvedValueOnce('```json\n{"services":[{"name":"Corte"}]}\n```')
    const out = await extract('sys', 'Corte 100', SERVICES_SCHEMA, 'services')
    expect(out).toEqual([{ name: 'Corte' }])
    expect(completeJson).toHaveBeenCalledWith(expect.objectContaining({ system: 'sys', schema: SERVICES_SCHEMA, turns: [{ role: 'user', content: 'Corte 100' }] }))
  })
})
