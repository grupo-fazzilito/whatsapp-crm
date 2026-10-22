import { describe, expect, it } from 'vitest'
import { disabledTypes, notificationLink, notificationVars } from './notifications'

describe('admin notifications', () => {
  it('reads the disabled types, defaulting to tokens.low', () => {
    expect(disabledTypes(null)).toEqual(['tokens.low'])
    expect(disabledTypes({ disabled: ['payment.failed', 'nope'] })).toEqual(['payment.failed'])
    expect(disabledTypes({ disabled: [] })).toEqual([])
  })

  it('links each type to its admin page', () => {
    expect(notificationLink('ticket.replied')).toBe('/admin-panel/support')
    expect(notificationLink('complaint.created')).toBe('/admin-panel/complaints')
    expect(notificationLink('payment.paid')).toBe('/admin-panel/billing')
    expect(notificationLink('workspace.created')).toBe('/admin-panel/clients')
  })

  it('builds the text values from the event data', () => {
    expect(notificationVars('payment.paid', { payment: { amount: 10, currency: 'USD', credits: 500, workspace_name: 'Ana' } }, null)).toMatchObject({
      business: 'Ana',
      amount: '10 USD',
      tokens: '500',
    })
    expect(notificationVars('ticket.created', { ticket: { number: 7, subject: 'Ayuda' } }, 'Panadería')).toMatchObject({ business: 'Panadería', number: '7', subject: 'Ayuda' })
    expect(notificationVars('user.signed_up', { user: { email: 'a@b.com', name: '' } }, null)).toMatchObject({ name: 'a@b.com', email: 'a@b.com', business: '—' })
  })
})
