import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { setPlatformSetting } from '@/lib/platform/settings'
import { supportSettings } from '@/lib/support/tickets'

/**
 * Support chat for businesses ("?" → Chat online): a web chat channel of the
 * platform's own workspace, answered from that workspace's inbox.
 * GET → { webchat_key, whatsapp, channels: [{ key, name, workspace }] }  PUT { webchat_key, whatsapp }
 */
async function view() {
  const s = await supportSettings()
  const channels = await prisma.channels.findMany({
    where: { type: 'webchat', status: 'connected' },
    select: { external_id: true, name: true, workspaces: { select: { name: true } } },
    orderBy: { created_at: 'asc' },
    take: 200,
  })
  return { webchat_key: s.webchat_key ?? '', whatsapp: s.whatsapp ?? '', channels: channels.map((c) => ({ key: c.external_id, name: c.name, workspace: c.workspaces.name })) }
}

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await view())
}

export async function PUT(request: Request) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { webchat_key?: unknown; whatsapp?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const key = typeof body.webchat_key === 'string' ? body.webchat_key.trim() : ''
  if (key) {
    const ch = await prisma.channels.findFirst({ where: { type: 'webchat', external_id: key }, select: { id: true } })
    if (!ch) return NextResponse.json({ error: 'web chat channel not found' }, { status: 400 })
  }
  const whatsapp = typeof body.whatsapp === 'string' ? body.whatsapp.replace(/[^\d]/g, '').slice(0, 15) : ''
  const user = await getSessionUser()
  await setPlatformSetting('support', { ...(key ? { webchat_key: key } : {}), ...(whatsapp ? { whatsapp } : {}) }, user?.id ?? null)
  return NextResponse.json(await view())
}
