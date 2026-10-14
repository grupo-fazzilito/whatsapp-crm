import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { buildAuthUrl } from '@/lib/integrations/calendly/api'
import { calendlyStateSecret } from '@/lib/integrations/calendly/model'
import { signState } from '@/lib/integrations/google/state'

/** GET — starts Calendly consent for the workspace (admins). */
export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { user, workspace } = guard.ctx
  const state = signState({ w: workspace.id, s: '', u: user.id }, calendlyStateSecret())
  const url = await buildAuthUrl(state)
  if (!url) return NextResponse.json({ error: 'Calendly is not configured on this platform' }, { status: 503 })
  return NextResponse.redirect(url, { status: 302 })
}
