import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { completeOAuth } from '@/lib/integrations/google/connect'
import { siteUrl } from '@/lib/integrations/google/endpoints'

/** Google redirects here after consent (Authorized redirect URI). */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const user = await getSessionUser()

  const outcome = await completeOAuth({
    code: url.searchParams.get('code'),
    state: url.searchParams.get('state'),
    error: url.searchParams.get('error'),
    userId: user?.id ?? null,
  })

  const target = new URL(outcome.back === 'profile' ? '/settings' : '/business/staff', siteUrl())
  if (outcome.back === 'profile') target.searchParams.set('tab', 'profile')
  if (outcome.ok) {
    target.searchParams.set('gcal', 'connected')
    target.searchParams.set('staff', outcome.staffId)
  } else {
    target.searchParams.set('gcal', 'error')
    target.searchParams.set('reason', outcome.error)
  }
  return NextResponse.redirect(target, { status: 303 })
}
