import 'server-only'
import { randomUUID } from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import { hashPassword } from './password'

// Account management done by the server (signup after OTP, password reset,
// platform admin), replacing supabase.auth.admin.*.

export interface NewUserInput {
  email: string
  password: string
  /** Signup data read by the provisioning trigger: full_name, business_name, business_type, locale, invite… */
  meta?: Record<string, unknown>
  emailVerified?: boolean
}

export async function findUserByEmail(email: string) {
  return prisma.users.findFirst({ where: { email: { equals: email.trim(), mode: 'insensitive' } } })
}

/** Creates the user + credential account. The users trigger creates profile and (unless invited) a workspace. */
export async function createUserWithPassword(input: NewUserInput) {
  const email = input.email.trim().toLowerCase()
  const hash = await hashPassword(input.password)
  return prisma.$transaction(async (tx) => {
    const user = await tx.users.create({
      data: {
        email,
        name: String(input.meta?.full_name ?? ''),
        email_verified: input.emailVerified ?? true,
        meta: (input.meta ?? {}) as object,
      },
    })
    await tx.auth_accounts.create({
      data: { id: randomUUID(), user_id: user.id, account_id: user.id, provider_id: 'credential', password: hash },
    })
    return user
  })
}

/** Sets (or creates) the password of a user; optionally signs them out everywhere. */
export async function setPassword(userId: string, password: string, opts: { revokeSessions?: boolean } = {}) {
  const hash = await hashPassword(password)
  const updated = await prisma.auth_accounts.updateMany({ where: { user_id: userId, provider_id: 'credential' }, data: { password: hash, updated_at: new Date().toISOString() } })
  if (updated.count === 0) {
    await prisma.auth_accounts.create({ data: { id: randomUUID(), user_id: userId, account_id: userId, provider_id: 'credential', password: hash } })
  }
  if (opts.revokeSessions) await prisma.auth_sessions.deleteMany({ where: { user_id: userId } })
}

export async function setBanned(userId: string, banned: boolean) {
  await prisma.users.update({ where: { id: userId }, data: { banned } })
  if (banned) await prisma.auth_sessions.deleteMany({ where: { user_id: userId } })
}

export async function deleteUser(userId: string) {
  await prisma.users.delete({ where: { id: userId } })
}

/** Account as the admin panel reads it (same field names Supabase's admin API used). */
export interface AdminUserView {
  id: string
  email: string
  created_at: string
  last_sign_in_at: string | null
  email_confirmed_at: string | null
  banned_until: string | null
  user_metadata: { full_name?: string }
  app_metadata: { provider: string }
}

const FOREVER = '2999-12-31T00:00:00.000Z'

export async function listUsersForAdmin(): Promise<AdminUserView[]> {
  const rows = await prisma.users.findMany({ orderBy: { created_at: 'desc' } })
  return rows.map((u) => ({
    id: u.id,
    email: u.email,
    created_at: u.created_at,
    last_sign_in_at: u.last_sign_in_at,
    email_confirmed_at: u.email_verified ? u.created_at : null,
    banned_until: u.banned ? FOREVER : null,
    user_metadata: { full_name: u.name || undefined },
    app_metadata: { provider: 'email' },
  }))
}
