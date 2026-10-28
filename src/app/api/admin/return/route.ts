import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@/lib/auth/server'
import { withAuthCookies } from '@/lib/auth/cookies'
import { publicOrigin } from '@/lib/site-origin'

// GET /api/admin/return — an admin viewing a customer's account opened the
// admin panel without the "back" button: end that visit (it gets its end time
// in the access log) and restore the admin session, then go to the panel.
export async function GET(req: NextRequest) {
  const out = (path: string) => NextResponse.redirect(new URL(path, publicOrigin(req)))
  // The plugin's endpoints aren't in the inferred api type (it is typed as BetterAuthPlugin).
  const api = auth().api as unknown as { stopImpersonating: (a: { headers: Headers; asResponse: true }) => Promise<Response> }
  const res = await api.stopImpersonating({ headers: req.headers, asResponse: true }).catch(() => null)
  if (!res?.ok) return out('/admin-panel/login')
  const body = (await res.clone().json().catch(() => null)) as { signedOut?: boolean } | null
  const next = req.nextUrl.searchParams.get('next')
  const target = body?.signedOut ? '/admin-panel/login' : next?.startsWith('/admin-panel') ? next : '/admin-panel'
  return withAuthCookies(res, out(target))
}
