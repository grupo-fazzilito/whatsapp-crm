import { describe, expect, it } from 'vitest'
import { defaultLayout, sanitizeLayout, widgetAvailable } from './widgets'

const store = { isAdmin: true, modules: { bookings: false, orders: true }, industry: 'store' }
const agentRealEstate = { isAdmin: false, modules: { bookings: true, orders: false }, industry: 'real_estate' }

describe('dashboard widgets', () => {
  it('default layout fits role, modules and industry', () => {
    const s = defaultLayout(store)
    expect(s).toContain('tokens')
    expect(s).toContain('orders_today')
    expect(s).not.toContain('bookings_today')
    expect(s).not.toContain('hot_leads')
    const r = defaultLayout(agentRealEstate)
    expect(r).not.toContain('tokens')
    expect(r).toContain('hot_leads')
    expect(r).toContain('bookings_today')
  })
  it('sanitizes saved layouts', () => {
    expect(sanitizeLayout(['meta_free_replies', 'x', 'new_leads', 'new_leads', 'orders_today'], agentRealEstate)).toEqual(['new_leads'])
    expect(sanitizeLayout('nope', store)).toEqual(defaultLayout(store))
    expect(sanitizeLayout(Array(50).fill('new_leads'), store)).toEqual(['new_leads'])
  })
  it('admin-only widgets', () => {
    expect(widgetAvailable('tokens', { ...store, isAdmin: false })).toBe(false)
    expect(widgetAvailable('meta_free_replies', store)).toBe(true)
  })
})
