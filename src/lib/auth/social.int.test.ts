// Google sign-in end to end through Better Auth's handler, with Google's
// token endpoint stubbed. TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/auth
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
  headers: async () => new Headers(),
}))
const pg = await pgTest()

const BASE = 'http://localhost:3001'
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
const idToken = (claims: object) => `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`

describe.skipIf(!pg)('Google / Facebook sign-in', async () => {
  if (!pg) return
  process.env.NEXT_PUBLIC_SITE_URL = BASE
  process.env.GOOGLE_CLIENT_ID = 'test-google-id'
  process.env.GOOGLE_CLIENT_SECRET = 'test-google-secret'
  const { auth, socialProviders } = await import('./server')
  const users = await import('./users')
  const stamp = Date.now()
  const made: { userId: string }[] = []
  afterAll(async () => {
    vi.restoreAllMocks()
    const ids = made.map((m) => m.userId)
    await pg.prisma.workspaces.deleteMany({ where: { created_by: { in: ids } } })
    await pg.prisma.users.deleteMany({ where: { id: { in: ids } } })
  })

  /** Starts sign-in, then returns from "Google" as `claims`. Returns the callback response. */
  async function signInWithGoogle(claims: Record<string, unknown>, sub: string) {
    const start = await auth().handler(
      new Request(`${BASE}/api/auth/sign-in/social`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', origin: BASE },
        body: JSON.stringify({ provider: 'google', callbackURL: '/dashboard', newUserCallbackURL: '/welcome' }),
      }),
    )
    const { url } = (await start.json()) as { url: string }
    const state = new URL(url).searchParams.get('state')!
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')

    const realFetch = globalThis.fetch
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (href.startsWith('https://oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'at', id_token: idToken({ sub, ...claims }), expires_in: 3600, token_type: 'Bearer' }), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return realFetch(input, init)
    })
    try {
      return await auth().handler(new Request(`${BASE}/api/auth/callback/google?code=c&state=${state}`, { headers: { cookie } }))
    } finally {
      spy.mockRestore()
    }
  }

  it('lists the providers that have keys', () => {
    expect(socialProviders()).toContain('google')
  })

  it('creates a new account without a business and sends it to /welcome', async () => {
    const email = `google-new-${stamp}@test.local`
    const res = await signInWithGoogle({ email, email_verified: true, name: 'Gabi Google' }, `g-new-${stamp}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/welcome')
    expect(res.headers.getSetCookie().join(';')).toMatch(/cnx\.session_token=/)

    const user = await pg.prisma.users.findFirstOrThrow({ where: { email } })
    made.push({ userId: user.id })
    expect(user).toMatchObject({ name: 'Gabi Google', email_verified: true })
    expect(user.meta).toMatchObject({ social: true, invite: true })
    expect(await pg.prisma.workspace_members.count({ where: { user_id: user.id } })).toBe(0)
    const account = await pg.prisma.auth_accounts.findFirstOrThrow({ where: { user_id: user.id, provider_id: 'google' } })
    // Tokens are stored encrypted.
    expect(account.access_token).not.toBe('at')
  })

  it('links Google to an existing email account and keeps its business', async () => {
    const email = `google-existing-${stamp}@test.local`
    const user = await users.createUserWithPassword({ email, password: 'Secreta123', meta: { full_name: 'Eva', business_name: 'Eva Biz', business_type: 'store' } })
    const member = await pg.prisma.workspace_members.findFirstOrThrow({ where: { user_id: user.id } })
    made.push({ userId: user.id })

    const res = await signInWithGoogle({ email, email_verified: true, name: 'Eva G' }, `g-old-${stamp}`)
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/dashboard')
    expect(await pg.prisma.users.count({ where: { email } })).toBe(1)
    expect(await pg.prisma.auth_accounts.count({ where: { user_id: user.id, provider_id: 'google' } })).toBe(1)
    expect(await pg.prisma.workspace_members.count({ where: { user_id: user.id } })).toBe(1)
  })
})
