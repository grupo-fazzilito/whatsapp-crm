import { describe, expect, it } from 'vitest'
import { marketingStateStale, normalizeStatus, parseMarketingTermsSigned, readMarketingState, usesMarketingApi } from './marketing'

const onboarded = { marketing_messages: { status: 'ONBOARDED', checked_at: '2026-10-20T00:00:00Z' } }

describe('Marketing Messages API routing', () => {
  it('only marketing templates of onboarded accounts use it', () => {
    expect(usesMarketingApi(onboarded, 'MARKETING')).toBe(true)
    expect(usesMarketingApi(onboarded, 'Marketing')).toBe(true)
    expect(usesMarketingApi(onboarded, 'UTILITY')).toBe(false)
    expect(usesMarketingApi(onboarded, undefined)).toBe(false)
    expect(usesMarketingApi({ marketing_messages: { status: 'ELIGIBLE', checked_at: '2026-10-20T00:00:00Z' } }, 'MARKETING')).toBe(false)
    expect(usesMarketingApi({}, 'MARKETING')).toBe(false)
  })

  it('reads the stored state and normalizes Meta values', () => {
    expect(readMarketingState(onboarded)).toEqual({ status: 'ONBOARDED', checked_at: '2026-10-20T00:00:00Z' })
    expect(readMarketingState({ marketing_messages: 'x' })).toBeNull()
    expect(normalizeStatus('eligible')).toBe('ELIGIBLE')
    expect(normalizeStatus('NOT_ELIGIBLE_FOR_MM')).toBe('NOT_ELIGIBLE')
    expect(normalizeStatus(undefined)).toBe('UNKNOWN')
  })

  it('checks again when missing or old, never once onboarded', () => {
    const now = Date.parse('2026-10-20T12:00:00Z')
    expect(marketingStateStale(null, now)).toBe(true)
    expect(marketingStateStale({ status: 'ELIGIBLE', checked_at: '2026-10-20T11:00:00Z' }, now)).toBe(false)
    expect(marketingStateStale({ status: 'ELIGIBLE', checked_at: '2026-10-20T01:00:00Z' }, now)).toBe(true)
    expect(marketingStateStale({ status: 'ONBOARDED', checked_at: '2025-01-01T00:00:00Z' }, now)).toBe(false)
  })

  it('picks the accounts that signed the terms from account_update webhooks', () => {
    expect(
      parseMarketingTermsSigned({
        object: 'whatsapp_business_account',
        entry: [
          { id: 'WABA1', changes: [{ field: 'account_update', value: { event: 'MM_LITE_TERMS_SIGNED' } }] },
          { id: 'WABA2', changes: [{ field: 'account_update', value: { event: 'PARTNER_ADDED' } }] },
          { id: 'WABA3', changes: [{ field: 'messages', value: {} }] },
        ],
      }),
    ).toEqual(['WABA1'])
    expect(parseMarketingTermsSigned({ object: 'page', entry: [{ id: 'P', changes: [{ field: 'account_update', value: { event: 'MM_LITE_TERMS_SIGNED' } }] }] })).toEqual([])
  })
})
