import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/messaging/send', () => ({ sendMessage: vi.fn() }))

import { isAffirmative, resolveDraftIds } from './engine'

const ctx = {
  services: [
    { id: '11111111-1111-1111-1111-111111111111', name: 'Corte clásico' },
    { id: '22222222-2222-2222-2222-222222222222', name: 'Corte + barba' },
  ],
  staff: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Luis' }],
} as never

describe('isAffirmative', () => {
  it.each(['Sí, confirmo', 'si', '¡Sí!', 'ok', 'Dale', 'confirmo', 'perfecto', 'Yes please'])('"%s" is a yes', (t) => {
    expect(isAffirmative(t)).toBe(true)
  })
  it.each(['no', 'mejor a las 11', '¿y el precio?', 'simplemente pregunto'])('"%s" is not', (t) => {
    expect(isAffirmative(t)).toBe(false)
  })
})

describe('resolveDraftIds', () => {
  it('maps names (any accent/case) to ids and normalizes 12h times', () => {
    const d = resolveDraftIds({ service_id: 'corte clasico', staff_id: 'luis', time: '10am', date: '2026-10-08' }, ctx)
    expect(d).toMatchObject({
      service_id: '11111111-1111-1111-1111-111111111111',
      staff_id: '33333333-3333-3333-3333-333333333333',
      time: '10:00',
    })
    expect(resolveDraftIds({ time: '3:30 pm' }, ctx).time).toBe('15:30')
  })
  it('keeps valid ids and drops unknown ones', () => {
    expect(resolveDraftIds({ service_id: '22222222-2222-2222-2222-222222222222' }, ctx).service_id).toBe('22222222-2222-2222-2222-222222222222')
    expect(resolveDraftIds({ service_id: '99999999-9999-9999-9999-999999999999' }, ctx).service_id).toBeNull()
    expect(resolveDraftIds({ staff_id: 'Pedro' }, ctx).staff_id).toBeNull()
  })
})

describe('longDate', async () => {
  const { longDate } = await import('./engine')
  it('formats in the business language and country', () => {
    const ctx = { workspace: { country: 'PE' } } as never
    expect(longDate('2026-10-08', 'es', ctx)).toBe('jueves, 8 de octubre')
    expect(longDate('2026-10-08', 'en', ctx)).toBe('Thursday, October 8')
  })
})

describe('history format and prose salvage', async () => {
  const { asJsonHistory, salvageProse } = await import('./engine')
  it('wraps past assistant turns as {"reply"} JSON, leaves user turns', () => {
    expect(
      asJsonHistory([
        { role: 'user', content: 'Hola' },
        { role: 'assistant', content: '¡Hola! ¿En qué te ayudo?' },
        { role: 'assistant', content: '{"reply":"ya es json"}' },
      ]),
    ).toEqual([
      { role: 'user', content: 'Hola' },
      { role: 'assistant', content: '{"reply":"¡Hola! ¿En qué te ayudo?"}' },
      { role: 'assistant', content: '{"reply":"ya es json"}' },
    ])
  })
  it('uses plain prose as the reply, but not empty or broken JSON', () => {
    expect(salvageProse('Sí, tenemos cera a S/ 40')?.reply).toBe('Sí, tenemos cera a S/ 40')
    expect(salvageProse('   ')).toBeNull()
    expect(salvageProse('{"reply": "cut')).toBeNull()
  })
})
