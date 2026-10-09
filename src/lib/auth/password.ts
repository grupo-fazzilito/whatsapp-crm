import bcrypt from 'bcryptjs'

// bcrypt, the same scheme Supabase Auth used: migrated users keep their passwords.
const ROUNDS = 10

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, ROUNDS)
}

export async function verifyPassword({ hash, password }: { hash: string; password: string }): Promise<boolean> {
  if (!hash || !hash.startsWith('$2')) return false
  return bcrypt.compare(password, hash)
}
