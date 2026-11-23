import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { formEncode, invoiceSubscriptionId, parseStripeEvent, stripeConfig, subscriptionPeriodEnd, toCents, verifyStripeSignature } from './stripe'

const SECRET = 'whsec_test'
const sign = (raw: string, t: number, secret = SECRET) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex')}`

describe('stripe', () => {
  it('reads the keys from the environment', () => {
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'sk_test_123', STRIPE_WEBHOOK_SECRET: 'whsec_1' })).toEqual({ secretKey: 'sk_test_123', webhookSecret: 'whsec_1' })
    expect(stripeConfig({ STRIPE_SECRET_KEY: 'pk_test_123' })).toBeNull()
    expect(stripeConfig({})).toBeNull()
  })

  it('encodes nested form fields like Stripe expects', () => {
    expect(formEncode({ mode: 'payment', line_items: [{ quantity: 1, price_data: { unit_amount: 1500 } }], metadata: { a: 'x y' } })).toEqual([
      'mode=payment',
      'line_items%5B0%5D%5Bquantity%5D=1',
      'line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=1500',
      'metadata%5Ba%5D=x%20y',
    ])
    expect(toCents(15)).toBe(1500)
    expect(toCents(19.99)).toBe(1999)
  })

  it('accepts a fresh signed delivery and refuses tampered, stale or foreign ones', () => {
    const raw = '{"type":"checkout.session.completed"}'
    const now = 1_763_000_000
    expect(verifyStripeSignature(raw, sign(raw, now), SECRET, now + 10)).toBe(true)
    expect(verifyStripeSignature(raw, `${sign(raw, now, 'old')},v1=${sign(raw, now).split('v1=')[1]}`, SECRET, now)).toBe(true)
    expect(verifyStripeSignature(raw.replace('completed', 'expired'), sign(raw, now), SECRET, now)).toBe(false)
    expect(verifyStripeSignature(raw, sign(raw, now), SECRET, now + 3600)).toBe(false)
    expect(verifyStripeSignature(raw, sign(raw, now, 'other'), SECRET, now)).toBe(false)
    expect(verifyStripeSignature(raw, null, SECRET, now)).toBe(false)
  })

  it('reads the payment from checkout and refund events', () => {
    expect(parseStripeEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', client_reference_id: 'p-1', payment_intent: 'pi_1' } } })).toEqual({
      type: 'checkout.session.completed', sessionId: 'cs_1', paymentId: 'p-1', paymentIntent: 'pi_1', mode: null, subscriptionId: null,
    })
    expect(parseStripeEvent({ type: 'checkout.session.completed', data: { object: { id: 'cs_2', mode: 'subscription', subscription: 'sub_1' } } })).toMatchObject({ mode: 'subscription', subscriptionId: 'sub_1' })
    expect(parseStripeEvent({ type: 'invoice.paid', data: { object: { id: 'in_1' } } })).toMatchObject({ invoiceId: 'in_1' })
    expect(parseStripeEvent({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_1' } } })).toMatchObject({ subscriptionId: 'sub_1' })
    expect(parseStripeEvent({ type: 'charge.refunded', data: { object: { payment_intent: 'pi_1', metadata: { payment_id: 'p-1' } } } })).toMatchObject({ paymentId: 'p-1', paymentIntent: 'pi_1' })
    expect(parseStripeEvent({ type: 'customer.created', data: { object: {} } })).toBeNull()
    expect(parseStripeEvent(null)).toBeNull()
  })

  it('finds the subscription and its period in old and new API shapes', () => {
    expect(invoiceSubscriptionId({ subscription: 'sub_1' } as never)).toBe('sub_1')
    expect(invoiceSubscriptionId({ parent: { subscription_details: { subscription: 'sub_2' } } } as never)).toBe('sub_2')
    expect(subscriptionPeriodEnd({ current_period_end: 10, items: { data: [{ current_period_end: 20 }] } } as never)).toBe(20)
    expect(subscriptionPeriodEnd({ current_period_end: 10, items: { data: [] } } as never)).toBe(10)
  })
})
