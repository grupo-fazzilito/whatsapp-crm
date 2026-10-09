import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { supportSettings } from '@/lib/support/tickets'

/** GET → { chat: { key } | null, whatsapp } — how the "?" menu reaches the platform team. */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const s = await supportSettings()
  let key: string | null = null
  if (s.webchat_key) {
    const ch = await prisma.channels.findFirst({ where: { type: 'webchat', external_id: s.webchat_key, status: 'connected' }, select: { id: true } })
    key = ch ? s.webchat_key : null
  }
  return NextResponse.json({ chat: key ? { key } : null, whatsapp: s.whatsapp ?? null })
}
