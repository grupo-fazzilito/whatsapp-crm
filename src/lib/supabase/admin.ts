import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Lazy, shared service-role client. Bypasses RLS: every query made with it
// MUST filter by workspace_id explicitly.
let _adminClient: SupabaseClient | null = null

export function supabaseAdmin(): SupabaseClient {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )
  }
  return _adminClient
}
