import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { computeLeadScore, monthsUntilMoveIn } from './score'
import { isQualified, mergeLead, normalizePropertyType, sanitizeLeadPatch, sanitizeUserLeadPatch } from './profile'
import { budgetComparable, leadsForProperty, matchProperty, propertyCurrency, rankProperties } from './match'
import { ruleMatches, sanitizeConditions, selectRule } from './routing'
import { agentOutputSchema, buildSystemPrompt } from '@/lib/ai/prompt'
import type { BusinessContext } from '@/lib/ai/context'
import type { AiAgentRow } from '@/lib/ai/types'
import type { LeadFields, MatchProperty, RoutingRule } from './types'

const NOW = new Date('2026-10-08T15:00:00Z')

describe('monthsUntilMoveIn', () => {
  it.each([
    ['me mudo el próximo mes', 1],
    ['inmediato', 0],
    ['en 3 meses', 3],
    ['en tres meses', 3],
    ['en 2 semanas', 0.5],
    ['el próximo año', 12],
    ['en un año', 12],
    ['para marzo', 5],
    ['diciembre 2026', 2],
    ['2027-01', 3],
    ['no sé todavía', null],
  ])('%s → %s', (text, months) => {
    expect(monthsUntilMoveIn(text, NOW)).toBe(months)
  })
})

describe('computeLeadScore', () => {
  const base: Partial<LeadFields> = { operation: 'rent', zones: ['Miraflores'], budget_max: 3000, currency: 'PEN', property_types: ['apartment'], bedrooms_min: 2, move_in: 'el próximo mes' }

  it('scores the example lead as warm', () => {
    const s = computeLeadScore(base, { inboundMessages: 1 }, NOW)
    expect(s.breakdown).toEqual({ completeness: 23, budget: 15, financing: 0, timeframe: 20, engagement: 1 })
    expect(s.score).toBe(59)
    expect(s.temperature).toBe('warm')
  })

  it('cash + short timeframe + engagement is hot', () => {
    const s = computeLeadScore({ ...base, financing: 'cash', purpose: 'live' }, { inboundMessages: 10, viewings: 1 }, NOW)
    expect(s.score).toBeGreaterThanOrEqual(70)
    expect(s.temperature).toBe('hot')
  })

  it('pre-approved mortgage scores almost like cash; plain mortgage less', () => {
    const pre = computeLeadScore({ ...base, financing: 'mortgage', mortgage_preapproved: true }, {}, NOW)
    const mort = computeLeadScore({ ...base, financing: 'mortgage' }, {}, NOW)
    expect(pre.breakdown.financing).toBe(18)
    expect(mort.breakdown.financing).toBe(8)
  })

  it('an empty profile is cold with score 0', () => {
    expect(computeLeadScore({}, {}, NOW)).toMatchObject({ score: 0, temperature: 'cold' })
  })

  it('timeframe tiers', () => {
    const tf = (move_in: string) => computeLeadScore({ move_in }, {}, NOW).breakdown.timeframe
    expect(tf('en 2 meses')).toBe(20)
    expect(tf('en 5 meses')).toBe(12)
    expect(tf('en 10 meses')).toBe(6)
    expect(tf('en 2 años')).toBe(2)
  })

  it('visit feedback overrides the temperature', () => {
    expect(computeLeadScore({}, { visitFeedback: 'interested' }, NOW).temperature).toBe('hot')
    const strong = { ...base, financing: 'cash' as const, purpose: 'live' as const }
    expect(computeLeadScore(strong, { inboundMessages: 10, viewings: 1, visitFeedback: 'not_convinced' }, NOW).temperature).toBe('warm')
  })
})

describe('lead profile patches', () => {
  it('sanitizes AI output: synonyms, currency, numbers; drops empties', () => {
    const p = sanitizeLeadPatch({
      operation: 'alquiler',
      property_types: ['Depa', 'departamento', ''],
      zones: [' Miraflores ', 'miraflores', 'San Isidro'],
      budget_max: '3,000',
      currency: 'soles',
      bedrooms_min: 2,
      financing: 'unknown',
      purpose: 'live',
      move_in: '',
      notes: '  ',
    })
    expect(p).toEqual({ operation: 'rent', property_types: ['apartment'], zones: ['Miraflores', 'San Isidro'], budget_max: 3000, currency: 'PEN', bedrooms_min: 2, purpose: 'live' })
  })

  it('swaps an inverted budget range', () => {
    expect(sanitizeLeadPatch({ budget_min: 500000, budget_max: 300000 })).toMatchObject({ budget_min: 300000, budget_max: 500000 })
  })

  it('merges without clearing known values', () => {
    const merged = mergeLead({ operation: 'rent', zones: ['Miraflores'], budget_max: 3000 }, { bedrooms_min: 2 })
    expect(merged).toMatchObject({ operation: 'rent', zones: ['Miraflores'], budget_max: 3000, bedrooms_min: 2, financing: 'unknown' })
    expect(mergeLead({}, { mortgage_preapproved: true }).financing).toBe('mortgage')
  })

  it('team edits can clear fields', () => {
    expect(sanitizeUserLeadPatch({ zones: [], budget_max: null, financing: 'unknown', operation: 'buy', alerts_opt_in: false })).toEqual({
      zones: [],
      budget_max: null,
      financing: 'unknown',
      operation: 'buy',
      alerts_opt_in: false,
    })
  })

  it('qualified = operation + zone + budget', () => {
    expect(isQualified({ operation: 'rent', zones: ['Miraflores'], budget_max: 3000 })).toBe(true)
    expect(isQualified({ operation: 'rent', zones: ['Miraflores'] })).toBe(false)
    expect(isQualified({ zones: ['Miraflores'], budget_max: 3000 })).toBe(false)
  })

  it('normalizes property types', () => {
    expect(normalizePropertyType('Casas')).toBe('house')
    expect(normalizePropertyType('local comercial')).toBe('commercial')
    expect(normalizePropertyType('Lote')).toBe('land')
  })
})

const prop = (over: Partial<MatchProperty> & { attributes?: Record<string, unknown> }): MatchProperty => ({
  id: over.id ?? 'p1',
  name: over.name ?? 'Depa Miraflores',
  price: over.price === undefined ? 2800 : over.price,
  currency: over.currency ?? null,
  images: over.images ?? ['https://x/1.jpg'],
  is_active: over.is_active ?? true,
  attributes: { operation: 'rent', property_type: 'apartment', bedrooms: 2, zone: 'Miraflores', listing_status: 'available', ...over.attributes },
})

describe('matching', () => {
  const lead: Partial<LeadFields> = { operation: 'rent', zones: ['Miraflores'], budget_max: 3000, currency: 'PEN', bedrooms_min: 2, property_types: ['apartment'] }
  const opts = { listingCurrency: 'PEN' }

  it('matches on operation, zone, budget (+10%), bedrooms and type', () => {
    expect(matchProperty(lead, prop({}), opts)).not.toBeNull()
    expect(matchProperty(lead, prop({ price: 3290 }), opts)).not.toBeNull() // within +10%
    expect(matchProperty(lead, prop({ price: 3400 }), opts)).toBeNull()
    expect(matchProperty(lead, prop({ attributes: { operation: 'sale' } }), opts)).toBeNull()
    expect(matchProperty(lead, prop({ attributes: { zone: 'Surco' } }), opts)).toBeNull()
    expect(matchProperty(lead, prop({ attributes: { bedrooms: 1 } }), opts)).toBeNull()
    expect(matchProperty(lead, prop({ attributes: { property_type: 'house' } }), opts)).toBeNull()
  })

  it('price on request passes; unknown attributes pass; other currencies skip the budget', () => {
    expect(matchProperty(lead, prop({ price: null }), opts)).not.toBeNull()
    expect(matchProperty(lead, prop({ attributes: { bedrooms: null, property_type: null } }), opts)).not.toBeNull()
    expect(matchProperty({ ...lead, currency: 'USD' }, prop({ price: 9000 }), opts)).not.toBeNull()
  })

  it('zones match by district or address, never by city alone', () => {
    expect(matchProperty({ zones: ['Miraflores, Lima'] }, prop({}), opts)).not.toBeNull()
    expect(matchProperty({ zones: ['miraflores'] }, prop({ attributes: { zone: 'San Isidro', address: 'Av. Larco 123, Miraflores' } }), opts)).not.toBeNull()
    expect(matchProperty({ zones: ['Lima'] }, prop({ attributes: { zone: 'Miraflores', city: 'Lima' } }), opts)).toBeNull()
  })

  it('hidden / reserved / inactive listings never match', () => {
    expect(matchProperty(lead, prop({ attributes: { listing_status: 'reserved' } }), opts)).toBeNull()
    expect(matchProperty(lead, prop({ attributes: { listing_status: 'sold' } }), opts)).toBeNull()
    expect(matchProperty(lead, prop({ is_active: false }), opts)).toBeNull()
  })

  it('ranks closer prices and exact bedrooms first', () => {
    const ranked = rankProperties(lead, [prop({ id: 'far', price: 1500 }), prop({ id: 'close', price: 2950 }), prop({ id: 'no', attributes: { zone: 'Surco' } })], 10, opts)
    expect(ranked.map((r) => r.product.id)).toEqual(['close', 'far'])
  })

  it('finds the leads a new listing fits (skipping leads without criteria)', () => {
    const leads = [
      { id: 'a', ...lead },
      { id: 'b', operation: 'buy' as const, zones: ['Miraflores'], budget_max: 500000 },
      { id: 'c' },
    ]
    expect(leadsForProperty(prop({}), leads, opts).map((l) => l.id)).toEqual(['a'])
  })
})

describe('routing rules', () => {
  const rule = (over: Partial<RoutingRule>): RoutingRule => ({
    id: over.id ?? 'r',
    workspace_id: 'ws',
    name: over.name ?? 'rule',
    priority: over.priority ?? 0,
    conditions: over.conditions ?? {},
    team_id: over.team_id === undefined ? 't1' : over.team_id,
    user_id: over.user_id ?? null,
    active: over.active ?? true,
  })
  const lead: Partial<LeadFields> = { operation: 'rent', zones: ['Miraflores'], budget_max: 3000, property_types: ['apartment'] }

  it('matches every defined condition', () => {
    expect(ruleMatches(rule({ conditions: { operation: 'rent', zones: ['miraflores', 'Barranco'] } }), lead)).toBe(true)
    expect(ruleMatches(rule({ conditions: { operation: 'buy' } }), lead)).toBe(false)
    expect(ruleMatches(rule({ conditions: { zones: ['San Isidro'] } }), lead)).toBe(false)
    expect(ruleMatches(rule({ conditions: { property_types: ['departamento'] } }), lead)).toBe(true)
    expect(ruleMatches(rule({ conditions: { property_types: ['house'] } }), lead)).toBe(false)
  })

  it('budget ranges must overlap; a lead without budget does not match a budget rule', () => {
    expect(ruleMatches(rule({ conditions: { budget_min: 2000, budget_max: 5000 } }), lead)).toBe(true)
    expect(ruleMatches(rule({ conditions: { budget_min: 4000 } }), lead)).toBe(false)
    expect(ruleMatches(rule({ conditions: { budget_max: 2000 } }), lead)).toBe(false)
    expect(ruleMatches(rule({ conditions: { budget_min: 1000 } }), { operation: 'rent' })).toBe(false)
  })

  it('picks the first active matching rule by priority', () => {
    const rules = [
      rule({ id: 'catchall', priority: 5 }),
      rule({ id: 'buyers', priority: 0, conditions: { operation: 'buy' } }),
      rule({ id: 'off', priority: 1, active: false }),
      rule({ id: 'mira', priority: 2, conditions: { zones: ['Miraflores'] } }),
    ]
    expect(selectRule(rules, lead)?.id).toBe('mira')
    expect(selectRule(rules, { operation: 'buy' })?.id).toBe('buyers')
    expect(selectRule([rule({ conditions: { operation: 'buy' } })], lead)).toBeNull()
  })

  it('sanitizes conditions from the API', () => {
    expect(sanitizeConditions({ zones: [' Miraflores ', 7], operation: 'alquiler', property_types: ['Depa'], budget_min: '5000', budget_max: 1000, extra: 1 })).toEqual({
      zones: ['Miraflores'],
      operation: 'rent',
      property_types: ['apartment'],
      budget_min: 1000,
      budget_max: 5000,
    })
  })
})

describe('agent prompt: lead qualification', () => {
  const ctx = (industry: string): BusinessContext =>
    ({
      workspace: { id: 'ws', name: 'Inmo', industry, currency: 'PEN', timezone: 'America/Lima', locale: 'es', settings: {} },
      timeZone: 'America/Lima',
      hours: [],
      exceptions: [],
      staff: [],
      services: [],
      faqs: [],
      agents: [],
      bookings: [],
      catalog: { categories: [], total: 0, products: [] },
    }) as unknown as BusinessContext
  const agent = (skills: string[]) => ({ id: 'a1', name: 'Leo', skills, tone: 'friendly', language: 'auto', transfer_agent_ids: [] }) as unknown as AiAgentRow
  const base = { transferTargets: [], draft: null, customerBookings: [], customerName: null, channelLabel: 'WhatsApp' }

  it('real-estate agents with catalog/bookings get the qualification and owner sections', () => {
    const prompt = buildSystemPrompt({ ...base, agent: agent(['faq', 'catalog']), ctx: ctx('real_estate'), leadProfile: { operation: 'rent', zones: ['Miraflores'] } })
    expect(prompt).toContain('LEAD QUALIFICATION')
    expect(prompt).toContain('ONE or TWO')
    expect(prompt).toContain('Already known: operation=rent, zones=Miraflores')
    expect(prompt).toMatch(/Still unknown: budget/)
    expect(prompt).toContain('OWNER LISTINGS')
    expect(prompt).toContain('lead_profile')
    const schema = agentOutputSchema('real_estate', ['catalog']) as { properties: Record<string, unknown> }
    expect(schema.properties.lead_profile).toBeDefined()
    expect(schema.properties.capture).toBeDefined()
  })

  it('other industries / agents without those skills do not', () => {
    expect(buildSystemPrompt({ ...base, agent: agent(['catalog']), ctx: ctx('restaurant') })).not.toContain('LEAD QUALIFICATION')
    expect(buildSystemPrompt({ ...base, agent: agent(['faq']), ctx: ctx('real_estate') })).not.toContain('LEAD QUALIFICATION')
    const schema = agentOutputSchema('restaurant', ['catalog']) as { properties: Record<string, unknown> }
    expect(schema.properties.lead_profile).toBeUndefined()
  })
})

describe('lead patch aliases (JSON-mode models)', () => {
  it('maps near-miss keys to the real fields', () => {
    expect(sanitizeLeadPatch({ operation: 'rent', budget: 3000, zone: 'Miraflores', bedrooms: 2, property_type: 'depa' })).toEqual({
      operation: 'rent',
      budget_max: 3000,
      zones: ['Miraflores'],
      bedrooms_min: 2,
      property_types: ['apartment'],
    })
    expect(sanitizeLeadPatch({ budget: 1, budget_max: 3000 }).budget_max).toBe(3000)
  })
})

describe('matching with mixed currencies (PEN workspace, USD sales)', () => {
  const opts = { listingCurrency: 'PEN' }
  const usdSale = prop({ id: 's1', price: 350000, currency: 'USD', attributes: { operation: 'sale' } })
  const penRent = prop({ id: 'r1', price: 2800 })
  const buyer: Partial<LeadFields> = { operation: 'buy', zones: ['Miraflores'], currency: 'USD', budget_max: 300000 }

  it('resolves the effective listing currency', () => {
    expect(propertyCurrency(usdSale, 'PEN')).toBe('USD')
    expect(propertyCurrency(penRent, 'PEN')).toBe('PEN')
    expect(propertyCurrency(prop({ attributes: { currency: 'usd' } }), 'PEN')).toBe('USD') // legacy attribute
  })

  it('compares the budget only in the same currency', () => {
    // USD 300k budget vs USD 350k listing: over budget (+10% is 330k).
    expect(matchProperty(buyer, usdSale, opts)).toBeNull()
    expect(matchProperty({ ...buyer, budget_max: 330000 }, usdSale, opts)).not.toBeNull()
    // A PEN budget never filters a USD listing (not comparable)...
    expect(budgetComparable({ ...buyer, currency: 'PEN' }, usdSale, 'PEN')).toBe(false)
    expect(matchProperty({ ...buyer, currency: 'PEN', budget_max: 1000 }, usdSale, opts)).not.toBeNull()
    // ...and an unknown lead currency counts as the workspace currency (PEN).
    expect(matchProperty({ ...buyer, currency: null, budget_max: 1000 }, usdSale, opts)).not.toBeNull()
    expect(matchProperty({ operation: 'rent', zones: ['Miraflores'], currency: null, budget_max: 2000 }, penRent, opts)).toBeNull()
    expect(matchProperty({ operation: 'rent', zones: ['Miraflores'], currency: null, budget_max: 3000 }, penRent, opts)).not.toBeNull()
  })

  it('a USD buyer is not matched to a PEN rental and vice versa', () => {
    const ranked = rankProperties(buyer, [usdSale, penRent], 10, opts)
    expect(ranked.map((m) => m.product.id)).toEqual([])
    expect(rankProperties({ ...buyer, budget_max: 330000 }, [usdSale, penRent], 10, opts).map((m) => m.product.id)).toEqual(['s1'])
  })
})
