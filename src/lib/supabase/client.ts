import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'
import { WORKSPACE_COOKIE, WORKSPACE_HEADER, isUuid } from '@/lib/workspace/constants'

// Singleton instance — one client shared across the whole browser session.
// Creating multiple clients causes auth-lock contention ("Lock was released
// because another request stole it") and intermittent fetch failures.
let browserClient: SupabaseClient | undefined

export function readWorkspaceCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(new RegExp(`(?:^|; )${WORKSPACE_COOKIE}=([^;]*)`))
  const value = match ? decodeURIComponent(match[1]) : null
  return isUuid(value) ? value : null
}

export function createClient() {
  if (browserClient) return browserClient

  // The active workspace is fixed for the lifetime of the page: switching
  // workspaces does a full reload so every query, cache and realtime
  // channel starts over scoped to the new one.
  const workspaceId = readWorkspaceCookie()

  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    workspaceId ? { global: { headers: { [WORKSPACE_HEADER]: workspaceId } } } : undefined
  )

  return browserClient
}
