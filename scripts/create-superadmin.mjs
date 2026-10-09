// Creates (or updates) the platform super-admin account: a user with
// profiles.is_platform_admin = true and NO workspace of its own.
//
//   npm run create-superadmin -- <email> <password>
//
// Re-running with an existing email resets its password and re-flags it.
// Needs DATABASE_URL (read from .env.local when present, otherwise from the environment).
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import pg from 'pg'

const [email, password] = process.argv.slice(2)
if (!email || !password) {
  console.error('Usage: npm run create-superadmin -- <email> <password>')
  process.exit(1)
}
if (password.length < 8) {
  console.error('Password must be at least 8 characters.')
  process.exit(1)
}
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL.')
  process.exit(1)
}

const normalized = email.trim().toLowerCase()
const hash = await bcrypt.hash(password, 10)
const db = new pg.Client({ connectionString: process.env.DATABASE_URL })
await db.connect()
try {
  await db.query('BEGIN')
  const found = await db.query('SELECT id FROM public.users WHERE lower(email) = $1', [normalized])
  let userId = found.rows[0]?.id
  if (userId) {
    const upd = await db.query(`UPDATE public.auth_accounts SET password = $2, updated_at = now() WHERE user_id = $1 AND provider_id = 'credential'`, [userId, hash])
    if (!upd.rowCount) {
      await db.query(`INSERT INTO public.auth_accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2::uuid, $2::text, 'credential', $3)`, [randomUUID(), userId, hash])
    }
    await db.query('UPDATE public.users SET email_verified = true, banned = false, updated_at = now() WHERE id = $1', [userId])
    await db.query('DELETE FROM public.auth_sessions WHERE user_id = $1', [userId])
    console.log(`Updated password for existing user ${normalized}`)
  } else {
    // meta.invite tells handle_new_user() not to create a workspace.
    userId = randomUUID()
    await db.query(`INSERT INTO public.users (id, email, name, email_verified, meta) VALUES ($1, $2, 'Super Admin', true, $3)`, [
      userId,
      normalized,
      { full_name: 'Super Admin', invite: true },
    ])
    await db.query(`INSERT INTO public.auth_accounts (id, user_id, account_id, provider_id, password) VALUES ($1, $2::uuid, $2::text, 'credential', $3)`, [randomUUID(), userId, hash])
    console.log(`Created user ${normalized}`)
  }
  const flagged = await db.query('UPDATE public.profiles SET is_platform_admin = true WHERE user_id = $1', [userId])
  if (!flagged.rowCount) throw new Error('profile row missing for this user')
  await db.query('COMMIT')
  console.log(`${normalized} is a platform super-admin. Sign in at /admin-panel/login`)
} catch (err) {
  await db.query('ROLLBACK').catch(() => {})
  console.error('Failed:', err.message)
  process.exitCode = 1
} finally {
  await db.end()
}
