// Creates (or updates) the platform super-admin account: a Supabase user
// with profiles.is_platform_admin = true and NO workspace of its own.
//
//   npm run create-superadmin -- <email> <password>
//
// Re-running with an existing email resets its password and re-flags it.
// Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (read from
// .env.local when present, otherwise from the environment).
import { createClient } from '@supabase/supabase-js'

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error('Usage: npm run create-superadmin -- <email> <password>')
  process.exit(1)
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.')
  process.exit(1)
}

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
const normalized = email.trim().toLowerCase()

async function findUser() {
  for (let page = 1; page < 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === normalized)
    if (hit || data.users.length < 200) return hit ?? null
  }
  return null
}

let user = await findUser()
if (user) {
  const { error } = await db.auth.admin.updateUserById(user.id, { password, email_confirm: true })
  if (error) throw error
  console.log(`Updated password for existing user ${normalized}`)
} else {
  // `invite: true` tells handle_new_user() not to create a workspace.
  const { data, error } = await db.auth.admin.createUser({
    email: normalized,
    password,
    email_confirm: true,
    user_metadata: { full_name: 'Super Admin', invite: true },
  })
  if (error) throw error
  user = data.user
  console.log(`Created user ${normalized}`)
}

const { error: flagErr } = await db
  .from('profiles')
  .upsert({ user_id: user.id, email: normalized, full_name: 'Super Admin', is_platform_admin: true }, { onConflict: 'user_id' })
if (flagErr) throw flagErr
console.log(`${normalized} is now a platform super-admin. Sign in at /admin-panel/login`)
