import { afterEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/admin/guard', () => ({ isPlatformAdmin: async () => false }))
const { canonicalRedirect } = await import('./proxy')

function req(url: string, init: { method?: string; host?: string } = {}) {
  const u = new URL(url)
  return new NextRequest(url, { method: init.method ?? 'GET', headers: { host: init.host ?? u.host } })
}

describe('canonicalRedirect', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('sends www and the railway address to the main domain, keeping path and query', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://whasalia.com')
    expect(canonicalRedirect(req('https://www.whasalia.com/es/pricing?x=1'))?.href).toBe('https://whasalia.com/es/pricing?x=1')
    expect(canonicalRedirect(req('https://app-a45a.up.railway.app/login'))?.href).toBe('https://whasalia.com/login')
  })

  it('leaves the main domain, API routes, non-GET requests and other hosts alone', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://whasalia.com')
    expect(canonicalRedirect(req('https://whasalia.com/es'))).toBeNull()
    expect(canonicalRedirect(req('https://app-a45a.up.railway.app/api/webhooks/meta'))).toBeNull()
    expect(canonicalRedirect(req('https://www.whasalia.com/login', { method: 'POST' }))).toBeNull()
    expect(canonicalRedirect(req('http://localhost:3001/dashboard'))).toBeNull()
  })

  it('does nothing while the site URL is still the railway address', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://app-a45a.up.railway.app')
    expect(canonicalRedirect(req('https://app-a45a.up.railway.app/es'))).toBeNull()
  })
})
