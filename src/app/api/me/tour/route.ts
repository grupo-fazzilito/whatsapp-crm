import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

/** PATCH { completed: boolean } — guided tour finished/skipped (true) or to show again (false). */
export async function PATCH(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { completed?: unknown } | null
  if (typeof body?.completed !== 'boolean') return NextResponse.json({ error: 'completed must be true or false' }, { status: 400 })
  await prisma.profiles.updateMany({ where: { user_id: user.id }, data: { tour_completed_at: body.completed ? new Date().toISOString() : null } })
  return NextResponse.json({ ok: true })
}
