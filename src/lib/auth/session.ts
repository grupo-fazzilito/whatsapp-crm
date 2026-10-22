import 'server-only'
import { headers } from 'next/headers'
import { auth } from './server'

/** The signed-in user (replaces Supabase's auth.getUser()). */
export interface AppUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
  /** A platform admin opened this account ("Entrar como cliente"): their user id. */
  impersonatedBy?: string | null
}

/** Current user from the session cookie, or null. Banned users get null. */
export async function getSessionUser(requestHeaders?: Headers): Promise<AppUser | null> {
  const session = await auth()
    .api.getSession({ headers: requestHeaders ?? (await headers()) })
    .catch(() => null)
  if (!session?.user) return null
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name ?? '',
    emailVerified: !!session.user.emailVerified,
    impersonatedBy: (session.session as { impersonatedBy?: string | null }).impersonatedBy ?? null,
  }
}
