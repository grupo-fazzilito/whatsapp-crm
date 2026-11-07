import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { saveMessengerSettings } from '@/lib/messenger-marketing/server'

/** PUT { auto_invite, invite_title, invite_image_url } (admins) → { settings } */
export async function PUT(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })
  return NextResponse.json({ settings: await saveMessengerSettings(guard.ctx.workspace.id, body) })
}
