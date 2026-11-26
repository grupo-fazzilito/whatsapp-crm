import { describe, expect, it } from 'vitest'
import { disconnectDate, extraChannelIds, mainChannelIds } from './accounts-model'

const ch = (id: string, type: string, day: number) => ({ id, type, created_at: new Date(Date.UTC(2026, 10, day)).toISOString() })

describe('main account per service', () => {
  it('is the first connected of each service; the rest are extra', () => {
    const list = [ch('wa2', 'whatsapp', 5), ch('wa1', 'whatsapp', 2), ch('ig1', 'instagram', 9), ch('wa3', 'whatsapp', 7)]
    expect([...mainChannelIds(list)].sort()).toEqual(['ig1', 'wa1'])
    expect(extraChannelIds(list).sort()).toEqual(['wa2', 'wa3'])
  })

  it('the extra ones go 30 days after the business started having them', () => {
    expect(disconnectDate(null)).toBeNull()
    expect(disconnectDate('2026-11-01T00:00:00Z')!.toISOString()).toBe('2026-12-01T00:00:00.000Z')
  })
})
