import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'

// Optimistic routing on the session cookie only. Every page/API still
// validates the session itself (requireWorkspace / isPlatformAdmin).
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname
  const signedIn = !!getSessionCookie(request, { cookiePrefix: 'cnx' })

  // Auth pages - redirect to dashboard if already logged in
  if (signedIn && (path === '/login' || path === '/signup' || path === '/forgot-password')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/flows', '/settings', '/healthcare', '/business', '/catalog', '/orders', '/agents', '/channels', '/tasks', '/reports', '/captures', '/real-estate']
  if (!signedIn && protectedPaths.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Platform admin panel: a session whose profile is_platform_admin.
  if (path.startsWith('/admin-panel') && path !== '/admin-panel/login') {
    let isAdmin = false
    if (signedIn) {
      const me = await fetch(new URL('/api/me', request.url), {
        headers: { cookie: request.headers.get('cookie') ?? '' },
        cache: 'no-store',
      }).catch(() => null)
      const body = me?.ok ? ((await me.json().catch(() => null)) as { profile?: { is_platform_admin?: boolean } } | null) : null
      isAdmin = !!body?.profile?.is_platform_admin
    }
    if (!isAdmin) {
      const url = request.nextUrl.clone()
      url.pathname = '/admin-panel/login'
      return NextResponse.redirect(url)
    }
  }

  // API routes that need auth (not webhooks)
  if (!signedIn && path.startsWith('/api/whatsapp/') && !path.includes('/webhook')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
