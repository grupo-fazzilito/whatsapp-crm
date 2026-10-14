import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { siteUrl } from '@/lib/integrations/google/endpoints'
import { verifyState } from '@/lib/integrations/google/state'
import { calendlyStateSecret } from '@/lib/integrations/calendly/model'
import { completeCalendlyConnect } from '@/lib/integrations/calendly/sync'

/** Calendly redirects here after consent (the OAuth app's redirect URI). */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const back = new URL('/settings', siteUrl())
  back.searchParams.set('tab', 'integrations')
  const fail = (reason: string) => {
    back.searchParams.set('calendly', 'error')
    back.searchParams.set('reason', reason)
    return NextResponse.redirect(back, { status: 303 })
  }

  if (url.searchParams.get('error')) return fail(url.searchParams.get('error') === 'access_denied' ? 'denied' : 'calendly')
  const check = verifyState(url.searchParams.get('state'), calendlyStateSecret())
  if (!check.ok) return fail(`state_${check.reason}`)
  const user = await getSessionUser()
  if (!user || user.id !== check.state.u) return fail('session')
  const code = url.searchParams.get('code')
  if (!code) return fail('code')
  // Re-check the role now: the workspace comes from the signed state.
  const member = await prisma.workspace_members.findFirst({ where: { workspace_id: check.state.w, user_id: user.id, status: 'active' }, select: { role: true } })
  if (!member || !['owner', 'admin'].includes(member.role)) return fail('forbidden')

  try {
    await completeCalendlyConnect({ workspaceId: check.state.w, userId: user.id, code })
  } catch (err) {
    console.error('[calendly] connect failed:', err instanceof Error ? err.message : err)
    return fail('calendly')
  }
  back.searchParams.set('calendly', 'connected')
  return NextResponse.redirect(back, { status: 303 })
}
