import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

/**
 * GET   /api/admin/profile → { name, email } of the signed-in platform admin.
 * PATCH /api/admin/profile { name } → updates their own name.
 * The password is changed through Better Auth (authClient.changePassword).
 */
export async function GET() {
  const user = await getSessionUser()
  if (!user || !(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  // From the table: the session keeps a cached copy of the name.
  const row = await prisma.users.findUnique({ where: { id: user.id }, select: { name: true, email: true } })
  return NextResponse.json({ name: row?.name ?? user.name, email: row?.email ?? user.email })
}

export async function PATCH(request: Request) {
  const user = await getSessionUser()
  if (!user || !(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { name?: unknown } | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : ''
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  // Platform client: the admin's own user and profile rows.
  await prisma.$transaction([
    prisma.users.update({ where: { id: user.id }, data: { name } }),
    prisma.profiles.updateMany({ where: { user_id: user.id }, data: { full_name: name } }),
  ])
  return NextResponse.json({ name, email: user.email })
}
