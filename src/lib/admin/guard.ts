import 'server-only'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

/**
 * Platform (SaaS operator) admin: a Supabase user with
 * profiles.is_platform_admin. Emails listed in PLATFORM_ADMIN_EMAILS are
 * promoted on first check, which bootstraps the first admin. Pass the
 * request headers when there is no request scope (the proxy).
 */
export async function isPlatformAdmin(requestHeaders?: Headers): Promise<boolean> {
  const user = await getSessionUser(requestHeaders)
  if (!user) return false

  const data = await prisma.profiles
    .findUnique({ where: { user_id: user.id }, select: { is_platform_admin: true } })
    .catch((err) => {
      console.error('[admin] profile lookup failed:', err instanceof Error ? err.message : err)
      return null
    })
  if (data?.is_platform_admin) return true

  const allow = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (user.email && allow.includes(user.email.toLowerCase())) {
    await prisma.profiles
      .updateMany({ where: { user_id: user.id }, data: { is_platform_admin: true } })
      .catch((err) => console.error('[admin] promote failed:', err instanceof Error ? err.message : err))
    return true
  }
  return false
}
