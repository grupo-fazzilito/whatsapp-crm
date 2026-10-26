import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { parseSender, sendEmail } = await import('./send')

describe('email sender', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('parses the sender', () => {
    expect(parseSender('Whasalia <no-reply@whasalia.com>')).toEqual({ name: 'Whasalia', email: 'no-reply@whasalia.com' })
    expect(parseSender('"Soporte" <support@whasalia.com>')).toEqual({ name: 'Soporte', email: 'support@whasalia.com' })
    expect(parseSender('no-reply@whasalia.com')).toEqual({ name: 'Whasalia', email: 'no-reply@whasalia.com' })
  })

  it('sends through MailerSend and surfaces its validation errors', async () => {
    vi.stubEnv('MAILERSEND_API_KEY', 'mlsn.test')
    vi.stubEnv('MAIL_FROM', '')
    vi.stubEnv('SMTP_FROM', '')
    const fetchMock = vi.fn(async () => new Response(null, { status: 202, headers: { 'x-message-id': 'abc' } }))
    vi.stubGlobal('fetch', fetchMock)
    expect(await sendEmail({ to: 'ana@example.com', subject: 'Hola', text: 'x' })).toEqual({ delivered: true })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.mailersend.com/v1/email')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mlsn.test')
    expect(JSON.parse(init.body as string)).toMatchObject({ from: { email: 'no-reply@whasalia.com', name: 'Whasalia' }, to: [{ email: 'ana@example.com' }], subject: 'Hola' })

    vi.stubGlobal('fetch', async () => Response.json({ message: 'invalid', errors: { 'from.email': ['The from.email domain must be verified.'] } }, { status: 422 }))
    await expect(sendEmail({ to: 'ana@example.com', subject: 'Hola', text: 'x' })).rejects.toThrow('MailerSend 422: The from.email domain must be verified.')
  })
})
