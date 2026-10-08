import { describe, expect, it, vi } from 'vitest'
import {
  GraphError,
  choosePhone,
  exchangeCode,
  isCoexistence,
  phoneInfo,
  randomPin,
  registerPhone,
  requestAppSync,
  subscribeApp,
} from './embedded-signup'

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status })

function ctxWith(...responses: Response[]) {
  const fetchMock = vi.fn(async (...args: [string, RequestInit?]) => (void args, responses.shift() ?? json({})))
  return { ctx: { base: 'https://graph.test/v25.0', fetch: fetchMock as unknown as typeof fetch }, fetchMock }
}

describe('embedded signup Graph calls', () => {
  it('exchanges the code with app id + secret (no redirect_uri)', async () => {
    const { ctx, fetchMock } = ctxWith(json({ access_token: 'BIZ', token_type: 'bearer' }))
    expect(await exchangeCode(ctx, { appId: 'APP', appSecret: 'SEC', code: 'C0DE' })).toBe('BIZ')
    const url = new URL(fetchMock.mock.calls[0][0] as unknown as string)
    expect(url.pathname).toBe('/v25.0/oauth/access_token')
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: 'APP', client_secret: 'SEC', code: 'C0DE' })
  })

  it('surfaces Meta errors', async () => {
    const { ctx } = ctxWith(json({ error: { message: 'Code expired', code: 100 } }, 400))
    await expect(exchangeCode(ctx, { appId: 'A', appSecret: 'S', code: 'x' })).rejects.toBeInstanceOf(GraphError)
  })

  it('subscribes, registers with a 6-digit PIN and requests both coexistence syncs', async () => {
    const { ctx, fetchMock } = ctxWith(json({ success: true }), json({ success: true }), json({ messaging_product: 'whatsapp', request_id: 'R1' }))
    await subscribeApp(ctx, '102290129340398', 'BIZ')
    await registerPhone(ctx, '106540352242922', 'BIZ', '123456')
    expect(await requestAppSync(ctx, '106540352242922', 'BIZ', 'history')).toBe('R1')
    const calls = fetchMock.mock.calls as unknown as [string, RequestInit][]
    expect(calls[0][0]).toBe('https://graph.test/v25.0/102290129340398/subscribed_apps')
    expect(calls[0][1].method).toBe('POST')
    expect((calls[0][1].headers as Record<string, string>).Authorization).toBe('Bearer BIZ')
    expect(JSON.parse(calls[1][1].body as string)).toEqual({ messaging_product: 'whatsapp', pin: '123456' })
    expect(calls[2][0]).toBe('https://graph.test/v25.0/106540352242922/smb_app_data')
    expect(JSON.parse(calls[2][1].body as string)).toEqual({ messaging_product: 'whatsapp', sync_type: 'history' })
  })

  it('reads is_on_biz_app and falls back when the version lacks the field', async () => {
    const ok = ctxWith(json({ id: '1', is_on_biz_app: true, platform_type: 'CLOUD_API', display_phone_number: '+51 987 654 321' }))
    expect(await phoneInfo(ok.ctx, '1', 'T')).toMatchObject({ is_on_biz_app: true })
    const old = ctxWith(json({ error: { message: 'Tried accessing nonexisting field (is_on_biz_app)', code: 100 } }, 400), json({ id: '1', display_phone_number: '1' }))
    expect(await phoneInfo(old.ctx, '1', 'T')).toEqual({ id: '1', display_phone_number: '1' })
  })
})

describe('pure helpers', () => {
  it('random PINs are 6 digits', () => {
    for (let i = 0; i < 50; i++) expect(randomPin()).toMatch(/^\d{6}$/)
  })

  it('chooses the returned number, else the first free one', () => {
    const phones = [{ id: '1' }, { id: '2' }]
    expect(choosePhone(phones, '2', new Set())?.id).toBe('2')
    expect(choosePhone(phones, null, new Set(['1']))?.id).toBe('2')
    expect(choosePhone(phones, null, new Set(['1', '2']))).toBeNull()
  })

  it('coexistence when chosen or reported by Meta', () => {
    expect(isCoexistence('coexistence', null)).toBe(true)
    expect(isCoexistence('standard', { is_on_biz_app: true })).toBe(true)
    expect(isCoexistence('standard', { is_on_biz_app: false })).toBe(false)
  })
})
