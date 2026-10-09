// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/auth
import { afterAll, describe, expect, it, vi } from 'vitest'
import bcrypt from 'bcryptjs'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, getAll: () => [] }),
  headers: async () => new Headers(),
}))
const pg = await pgTest()

describe.skipIf(!pg)('Better Auth on our tables', async () => {
  if (!pg) return
  process.env.NEXT_PUBLIC_SITE_URL = 'http://localhost:3001'
  const { auth } = await import('./server')
  const users = await import('./users')
  const { getSessionUser } = await import('./session')
  const email = `auth-${Date.now()}@test.local`
  const made: { userId: string; workspaceId: string }[] = []
  afterAll(async () => {
    await pg.cleanup(...made)
  })

  const signIn = (password: string) =>
    auth().api.signInEmail({ body: { email, password }, asResponse: true, headers: new Headers({ origin: 'http://localhost:3001' }) })

  it('creates the user, provisions the workspace and signs in with a session cookie', async () => {
    const user = await users.createUserWithPassword({ email, password: 'Secreta123', meta: { full_name: 'Ana Auth', business_name: 'Auth Biz', business_type: 'store' } })
    const member = await pg.prisma.workspace_members.findFirstOrThrow({ where: { user_id: user.id } })
    made.push({ userId: user.id, workspaceId: member.workspace_id })
    expect(member.role).toBe('owner')

    expect((await signIn('mala')).status).toBe(401)
    const res = await signIn('Secreta123')
    expect(res.status).toBe(200)
    const cookie = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ')
    expect(cookie).toMatch(/cnx\.session_token=/)
    const me = await getSessionUser(new Headers({ cookie }))
    expect(me).toMatchObject({ id: user.id, email, name: 'Ana Auth' })
    expect((await pg.prisma.users.findUnique({ where: { id: user.id } }))?.last_sign_in_at).toBeTruthy()
  })

  it('accepts bcrypt hashes copied from Supabase and new passwords', async () => {
    const u = await users.findUserByEmail(email.toUpperCase())
    await pg.prisma.auth_accounts.updateMany({ where: { user_id: u!.id }, data: { password: bcrypt.hashSync('DesdeSupabase1', 10).replace('$2b$', '$2a$') } })
    expect((await signIn('DesdeSupabase1')).status).toBe(200)
    await users.setPassword(u!.id, 'Nueva456', { revokeSessions: true })
    expect(await pg.prisma.auth_sessions.count({ where: { user_id: u!.id } })).toBe(0)
    expect((await signIn('Nueva456')).status).toBe(200)
  })

  it('banned users cannot sign in and lose their sessions', async () => {
    const u = await users.findUserByEmail(email)
    await users.setBanned(u!.id, true)
    expect(await pg.prisma.auth_sessions.count({ where: { user_id: u!.id } })).toBe(0)
    expect((await signIn('Nueva456')).status).not.toBe(200)
    await users.setBanned(u!.id, false)
    expect((await signIn('Nueva456')).status).toBe(200)
  })

  it('self sign-up through the API is disabled (accounts come from the OTP flow)', async () => {
    const res = await auth().api.signUpEmail({ body: { email: `x-${email}`, password: 'Secreta123', name: 'X' }, asResponse: true, headers: new Headers({ origin: 'http://localhost:3001' }) })
    expect(res.status).toBeGreaterThanOrEqual(400)
  })
})
