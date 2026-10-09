import crypto from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkTopup, creditsFor, DEFAULT_BILLING, normalizeBilling } from './pricing'
import { checkBillingAccount } from './account'
import {
  createPayin,
  expiryDate,
  formatAmount,
  parsePayinWebhook,
  payinBody,
  payinChecksum,
  plainName,
  queryPayin,
  PaymentLatamError,
  type PaymentLatamConfig,
} from './payment-latam'

const cfg: PaymentLatamConfig = {
  baseUrl: 'https://pl.example:8093/',
  merchantCode: '35119',
  secretUser: 'usuario_demo',
  secretPass: 'clave',
  amountFormat: 'fixed2',
}

describe('pricing', () => {
  it('defaults: S/0.05 per credit, S/50 minimum, 6 months', () => {
    expect(normalizeBilling(null)).toEqual(DEFAULT_BILLING)
    expect(creditsFor(50, DEFAULT_BILLING)).toBe(1000)
  })
  it('drops out-of-range values and packs under the minimum', () => {
    const s = normalizeBilling({ credit_price: -1, min_topup: 50, packs: [20, 100, 100, 50], expiry_months: 0, action_costs: { reply: 3 } as never })
    expect(s.credit_price).toBe(0.05)
    expect(s.packs).toEqual([50, 100])
    expect(s.expiry_months).toBe(6)
    expect(s.action_costs.reply).toBe(3)
    expect(s.action_costs.vision).toBe(2)
  })
  it('top-ups are whole soles ≥ minimum', () => {
    expect(checkTopup(49, DEFAULT_BILLING)).toEqual({ ok: false, error: 'below_minimum' })
    expect(checkTopup(50.5, DEFAULT_BILLING)).toEqual({ ok: false, error: 'invalid_amount' })
    expect(checkTopup('100', DEFAULT_BILLING)).toEqual({ ok: true, amount: 100, credits: 2000 })
    expect(checkTopup(60_000, DEFAULT_BILLING)).toEqual({ ok: false, error: 'too_large' })
  })
  it('does not lose a credit to float rounding', () => {
    expect(creditsFor(70, { ...DEFAULT_BILLING, credit_price: 0.07 })).toBe(1000)
  })
})

describe('billing account', () => {
  it('validates document by type', () => {
    expect(checkBillingAccount({ doc_type: 1, doc_number: '1234567', legal_name: 'Ana', email: 'a@b.pe' })).toEqual({ ok: false, error: 'doc_number' })
    expect(checkBillingAccount({ doc_type: 2, doc_number: '20123456789', legal_name: ' Inmobiliaria  Sol SAC ', email: 'Pagos@Sol.PE' })).toEqual({
      ok: true,
      value: { doc_type: 2, doc_number: '20123456789', legal_name: 'Inmobiliaria Sol SAC', email: 'pagos@sol.pe' },
    })
    expect(checkBillingAccount({ doc_type: 9, doc_number: '1', legal_name: 'x', email: 'x' })).toEqual({ ok: false, error: 'doc_type' })
    expect(checkBillingAccount({ doc_type: 1, doc_number: '12345678', legal_name: 'Ana', email: 'nope' })).toEqual({ ok: false, error: 'email' })
  })
})

describe('Payment Latam payin', () => {
  it('checksum = SHA512(user + pass + merchant + documento + email + importe)', () => {
    const expected = crypto.createHash('sha512').update('usuario_democlave3511912345678cliente@correo.com100.00').digest('hex')
    expect(payinChecksum(cfg, '12345678', 'cliente@correo.com', '100.00')).toBe(expected)
  })

  it('writes importe with the same text in the body and the checksum', () => {
    for (const [format, text] of [['fixed2', '50.00'], ['fixed1', '50.0'], ['plain', '50']] as const) {
      const c = { ...cfg, amountFormat: format }
      const body = payinBody(c, { docType: 1, document: '12345678', name: 'José Pérez', email: 'jose@correo.pe', amount: 50, expiresOn: '2026-10-11', webhookUrl: 'https://app/x?p=1&s=2' })
      expect(body).toContain(`"importe":${text},`)
      const parsed = JSON.parse(body)
      expect(parsed).toMatchObject({ codigoMerchant: '35119', fecha_caduca: '2026-10-11', idtipodocumento: 1, documento: '12345678', nombres: 'JOSE PEREZ', email: 'jose@correo.pe', urlWebhook: 'https://app/x?p=1&s=2' })
      expect(parsed.checksum).toBe(payinChecksum(c, '12345678', 'jose@correo.pe', text))
    }
    expect(formatAmount(75, 'fixed2')).toBe('75.00')
  })

  it('names without accents or special characters', () => {
    expect(plainName('  Ñandú & Cía. — Pérez  ')).toBe('NANDU CIA PEREZ')
  })

  it('expiry dates are Lima dates capped at 30 days', () => {
    const now = new Date('2026-10-09T03:00:00Z') // 2026-10-08 22:00 in Lima
    expect(expiryDate(0, now)).toBe('2026-10-08')
    expect(expiryDate(2, now)).toBe('2026-10-10')
    expect(expiryDate(90, now)).toBe('2026-11-07')
  })

  it('parses webhook payloads (PascalCase) and ignores junk', () => {
    expect(parsePayinWebhook({ Estado: 'APROBADA', Monto: 100.0, OrdenID: 'ORD1', Referencia: 987, checkout: 'https://c' })).toEqual({
      estado: 'APROBADA',
      monto: 100,
      ordenID: 'ORD1',
      referencia: '987',
      checkout: 'https://c',
    })
    expect(parsePayinWebhook([])).toBeNull()
    expect(parsePayinWebhook({ Estado: 'APROBADA' })).toBeNull()
  })
})

describe('Payment Latam client', () => {
  afterEach(() => vi.unstubAllGlobals())
  const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status })

  it('gets a token, then creates the order with Bearer auth', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: 'tok1', errorMensaje: '' }))
      .mockResolvedValueOnce(json({ codigo: 'OK', errorMensaje: '', result: { estado: 'PENDIENTE', monto: 50.0, ordenID: 'ORD9', referencia: '111', checkout: 'https://pay-met.pe/checkout/ORD9' } }))
    vi.stubGlobal('fetch', fetchMock)
    const c = { ...cfg, secretUser: 'u-create' }
    const r = await createPayin(c, { docType: 1, document: '12345678', name: 'Ana', email: 'a@b.pe', amount: 50, expiresOn: '2026-10-11' })
    expect(r).toEqual({ estado: 'PENDIENTE', monto: 50, ordenID: 'ORD9', referencia: '111', checkout: 'https://pay-met.pe/checkout/ORD9' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://pl.example:8093/api/Auth/generaToken')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ secretUser: 'u-create', secretPass: 'clave', codigo_merchant: '35119' })
    expect(fetchMock.mock.calls[1][0]).toBe('https://pl.example:8093/ServicioPayin/ingresaOrdenRecaudo')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer tok1')
  })

  it('regenerates the token once on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ token: 'old' }))
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(json({ token: 'new' }))
      .mockResolvedValueOnce(json({ codigo: 'OK', result: { estado: 'APROBADA', monto: 50, ordenID: 'ORD9' } }))
    vi.stubGlobal('fetch', fetchMock)
    const r = await queryPayin({ ...cfg, secretUser: 'u-401' }, 'ORD9')
    expect(r.estado).toBe('APROBADA')
    expect(fetchMock.mock.calls[3][1].headers.Authorization).toBe('Bearer new')
    expect(JSON.parse(fetchMock.mock.calls[3][1].body)).toEqual({ codigo_merchant: '35119', OrdenID: 'ORD9' })
  })

  it('surfaces gateway errors', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(json({ token: '', errorMensaje: 'Credencial inválida' })))
    await expect(queryPayin({ ...cfg, secretUser: 'u-bad' }, 'X')).rejects.toThrow('Credencial inválida')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(json({ token: 't' })).mockResolvedValueOnce(json({ codigo: 'error', errorMensaje: 'Checksum inválido' })),
    )
    await expect(createPayin({ ...cfg, secretUser: 'u-err' }, { docType: 1, document: '1', name: 'a', email: 'a', amount: 50, expiresOn: 'x' })).rejects.toBeInstanceOf(PaymentLatamError)
  })
})
