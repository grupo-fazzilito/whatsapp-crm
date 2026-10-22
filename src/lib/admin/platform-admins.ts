import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { prisma } from '@/lib/db/prisma'

// Who is a platform admin, without going through the session (the auth
// server itself uses this, so it can't import the session helpers).

function allowList(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
}

/** profiles.is_platform_admin, or the email is in PLATFORM_ADMIN_EMAILS. */
export async function isPlatformAdminUser(user: { id?: string | null; email?: string | null }): Promise<boolean> {
  if (user.email && allowList().includes(user.email.toLowerCase())) return true
  if (!user.id) return false
  const profile = await prisma.profiles.findUnique({ where: { user_id: user.id }, select: { is_platform_admin: true } }).catch(() => null)
  return !!profile?.is_platform_admin
}

export async function isPlatformAdminEmail(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase()
  if (!e) return false
  if (allowList().includes(e)) return true
  const user = await prisma.users.findFirst({ where: { email: { equals: e, mode: 'insensitive' } }, select: { id: true } }).catch(() => null)
  return !!user && (await isPlatformAdminUser({ id: user.id }))
}

// Platform admins may only sign in through /admin-panel/login. That route
// adds this header (an HMAC of the auth secret) to its server-side sign-in.

export const ADMIN_LOGIN_HEADER = 'x-whasalia-admin-login'

function secret(): string {
  return process.env.BETTER_AUTH_SECRET || `dev-only:${process.env.ENCRYPTION_KEY ?? 'insecure'}`
}

export function adminLoginMark(): string {
  return createHmac('sha256', secret()).update('whasalia-admin-login').digest('hex')
}

export function hasAdminLoginMark(headers: Headers | null | undefined): boolean {
  const got = headers?.get(ADMIN_LOGIN_HEADER)
  if (!got) return false
  const want = adminLoginMark()
  return got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want))
}
