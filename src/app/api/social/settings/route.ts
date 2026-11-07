import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { loadSocialWorkspace, saveSocialSettings, socialSettingsOf } from '@/lib/social/server'

/** GET → { settings, whatsapp: [{ id, name }] } */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace, db } = guard.ctx
  const whatsapp = await db.channels.findMany({ where: { type: 'whatsapp', status: 'connected' }, select: { id: true, name: true, display_handle: true } })
  return NextResponse.json({ settings: socialSettingsOf(workspace), whatsapp })
}

/** PUT { ...settings } (admins) → { settings } */
export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  const ws = await loadSocialWorkspace(guard.ctx.workspace.id)
  if (!ws) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ settings: await saveSocialSettings(ws, body, guard.ctx.user.id) })
}
