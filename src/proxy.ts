import { NextResponse, type NextRequest } from 'next/server'
import { getSessionCookie } from 'better-auth/cookies'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale } from '@/i18n/config'
import { isMarketingPath, localizedPath, splitLocale } from '@/i18n/marketing-routes'

// Optimistic routing on the session cookie only. Every page/API still
// validates the session itself (requireWorkspace / isPlatformAdmin).
export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname

  // Pages opened on www.<domain> or the *.up.railway.app address move to the
  // main domain. API routes are left alone: webhooks, cron jobs and stored
  // file links may still use the old address, and a redirect would drop POSTs.
  const canonical = canonicalRedirect(request)
  if (canonical) return NextResponse.redirect(canonical, 308)

  const signedIn = !!getSessionCookie(request, { cookiePrefix: 'cnx' })

  // Public pages have one URL per language (/es/..., /en/...) for SEO.
  const localized = splitLocale(path)
  if (localized && isMarketingPath(localized.path || '/')) {
    const headers = new Headers(request.headers)
    headers.set('x-locale', localized.locale)
    headers.set('x-marketing-path', localized.path)
    const res = NextResponse.next({ request: { headers } })
    // The language of the page visited becomes the visitor's language.
    if (request.cookies.get(LOCALE_COOKIE)?.value !== localized.locale) {
      res.cookies.set(LOCALE_COOKIE, localized.locale, { path: '/', maxAge: 31_536_000, sameSite: 'lax' })
    }
    return res
  }
  if (isMarketingPath(path)) {
    const saved = request.cookies.get(LOCALE_COOKIE)?.value
    const url = request.nextUrl.clone()
    url.pathname = localizedPath(isLocale(saved) ? saved : DEFAULT_LOCALE, path)
    return NextResponse.redirect(url, 307)
  }

  // Auth pages - redirect to dashboard if already logged in
  if (signedIn && (path === '/login' || path === '/signup' || path === '/forgot-password')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  // Protected pages - redirect to login if not authenticated
  const protectedPaths = ['/dashboard', '/inbox', '/contacts', '/pipelines', '/broadcasts', '/automations', '/flows', '/settings', '/healthcare', '/business', '/catalog', '/orders', '/agents', '/channels', '/tasks', '/reports', '/captures', '/real-estate', '/support', '/welcome']
  if (!signedIn && protectedPaths.some((p) => path.startsWith(p))) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Platform admin panel: a session whose profile is_platform_admin.
  // Checked in-process (a fetch to our own /api/me fails behind Railway's proxy).
  if (path.startsWith('/admin-panel') && path !== '/admin-panel/login') {
    const isAdmin = signedIn && (await isPlatformAdmin(request.headers).catch(() => false))
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

/** URL on the main domain (NEXT_PUBLIC_SITE_URL) for a page opened on an alternate host, else null. */
export function canonicalRedirect(request: NextRequest): URL | null {
  const site = process.env.NEXT_PUBLIC_SITE_URL
  if (!site || request.nextUrl.pathname.startsWith('/api/')) return null
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  let main: URL
  try { main = new URL(site) } catch { return null }
  const host = (request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? '').split(':')[0].toLowerCase()
  if (!host || host === main.hostname) return null
  const alternate = host === `www.${main.hostname}` || host.endsWith('.up.railway.app')
  if (!alternate) return null
  return new URL(request.nextUrl.pathname + request.nextUrl.search, main)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
