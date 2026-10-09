import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** PATCH /api/me/email { email } — changes the signed-in account's email (login + profile). */
export async function PATCH(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { email?: unknown } | null
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  if (!EMAIL_RE.test(email) || email.length > 254) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  if (email === user.email.toLowerCase()) return NextResponse.json({ ok: true })
  const taken = await prisma.users.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, NOT: { id: user.id } }, select: { id: true } })
  if (taken) return NextResponse.json({ error: 'Email is already in use' }, { status: 409 })
  await prisma.$transaction([
    prisma.users.update({ where: { id: user.id }, data: { email } }),
    prisma.profiles.updateMany({ where: { user_id: user.id }, data: { email } }),
  ])
  return NextResponse.json({ ok: true })
}
