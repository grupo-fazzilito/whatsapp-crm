import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
const completeJson = vi.fn()
vi.mock('@/lib/ai/llm', async (orig) => ({ ...(await orig<typeof import('@/lib/ai/llm')>()), completeJson: (...a: unknown[]) => completeJson(...a) }))

const pg = await pgTest()
// Without a test database the pure tests still load the module: the Prisma
// client only connects on its first query.
process.env.DATABASE_URL ??= 'postgresql://unused@127.0.0.1:1/unused'
const { extract, faqsPrompt, normalizeFaqs, normalizeServices, saveFaqs, saveServices, servicesPrompt, SERVICES_SCHEMA } = await import('./importer')
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
    const out = await extract('sys', 'Corte 100', SERVICES_SCHEMA, 'services', 'ws-1')
    expect(out).toEqual([{ name: 'Corte' }])
    expect(completeJson).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'sys',
        schema: SERVICES_SCHEMA,
        turns: [{ role: 'user', content: 'Corte 100' }],
        meter: { workspaceId: 'ws-1', purpose: 'import' },
      }),
    )
  })
})

// Real PostgreSQL (skipped without TEST_DATABASE_URL).
describe.skipIf(!pg)('saveServices / saveFaqs', () => {
  let made: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  beforeAll(async () => {
    made = await pg!.workspace({ businessType: 'barbershop' })
  })
  afterAll(async () => {
    if (made) await pg!.cleanup(made)
  })

  it('insert into the workspace and return how many were saved', async () => {
    expect(await saveServices(made.workspaceId, [])).toBe(0)
    const before = await made.db.services.count()
    expect(
      await saveServices(made.workspaceId, [
        { name: 'Corte', description: '', category: 'Cabello', price: 1200, price_is_from: true, duration_minutes: 45 },
        { name: 'Barba', description: 'Con toalla', category: '', price: 99.5, price_is_from: false, duration_minutes: 30 },
      ]),
    ).toBe(2)
    expect(await made.db.services.count()).toBe(before + 2)
    const barba = await made.db.services.findFirstOrThrow({ where: { name: 'Barba' } })
    expect(barba).toMatchObject({ description: 'Con toalla', category: null, price: 99.5, is_active: true, workspace_id: made.workspaceId })

    expect(await saveFaqs(made.workspaceId, [{ question: '¿Abren?', answer: 'Sí', keywords: '' }])).toBe(1)
    expect(await made.db.faqs.findFirstOrThrow({ where: { question: '¿Abren?' } })).toMatchObject({ answer: 'Sí', keywords: null })
  })
})
