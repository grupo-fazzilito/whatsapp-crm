import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

/** POST — the assisted-setup offer was answered (WhatsApp or "no thanks"); it isn't shown again. */
export async function POST() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await prisma.profiles.updateMany({ where: { user_id: user.id, setup_offer_seen_at: null }, data: { setup_offer_seen_at: new Date().toISOString() } })
  return NextResponse.json({ ok: true })
}
