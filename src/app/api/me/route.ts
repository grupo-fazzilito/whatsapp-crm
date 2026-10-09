import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

/** GET /api/me → { user, profile } of the signed-in account (401 when signed out). */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [profile, row] = await Promise.all([
    prisma.profiles.findFirst({
      where: { user_id: user.id },
      select: { id: true, full_name: true, email: true, avatar_url: true, role: true, beta_features: true, is_platform_admin: true, locale: true, tour_completed_at: true },
    }),
    prisma.users.findUnique({ where: { id: user.id }, select: { created_at: true } }),
  ])
  return NextResponse.json({
    user: { id: user.id, email: user.email, created_at: row?.created_at ?? null, user_metadata: { full_name: profile?.full_name ?? user.name } },
    profile: profile ? { ...profile, beta_features: profile.beta_features ?? [] } : null,
  })
}
