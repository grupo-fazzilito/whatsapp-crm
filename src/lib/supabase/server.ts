import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { WORKSPACE_COOKIE, WORKSPACE_HEADER, isUuid } from '@/lib/workspace/constants'

/**
 * Cookie-authenticated client. Queries are scoped by RLS to the active
 * workspace (cookie) unless `workspaceId` overrides it.
 */
export async function createClient(workspaceId?: string | null) {
  const cookieStore = await cookies()
  const cookieWs = cookieStore.get(WORKSPACE_COOKIE)?.value
  const ws = workspaceId ?? (isUuid(cookieWs) ? cookieWs : null)

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      ...(ws ? { global: { headers: { [WORKSPACE_HEADER]: ws } } } : {}),
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  )
}
