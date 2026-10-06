import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * Platform (SaaS operator) admin: a Supabase user with
 * profiles.is_platform_admin. Emails listed in PLATFORM_ADMIN_EMAILS are
 * promoted on first check, which bootstraps the first admin.
 */
export async function isPlatformAdmin(): Promise<boolean> {
  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  if (!user) return false

  const db = supabaseAdmin()
  const { data } = await db.from('profiles').select('is_platform_admin').eq('user_id', user.id).maybeSingle()
  if (data?.is_platform_admin) return true

  const allow = (process.env.PLATFORM_ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  if (user.email && allow.includes(user.email.toLowerCase())) {
    await db.from('profiles').update({ is_platform_admin: true }).eq('user_id', user.id)
    return true
  }
  return false
}
