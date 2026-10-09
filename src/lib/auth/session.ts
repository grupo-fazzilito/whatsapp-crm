import 'server-only'
import { headers } from 'next/headers'
import { auth } from './server'

/** The signed-in user (replaces Supabase's auth.getUser()). */
export interface AppUser {
  id: string
  email: string
  name: string
  emailVerified: boolean
}

/** Current user from the session cookie, or null. Banned users get null. */
export async function getSessionUser(requestHeaders?: Headers): Promise<AppUser | null> {
  const session = await auth()
    .api.getSession({ headers: requestHeaders ?? (await headers()) })
    .catch(() => null)
  if (!session?.user) return null
  return { id: session.user.id, email: session.user.email, name: session.user.name ?? '', emailVerified: !!session.user.emailVerified }
}
