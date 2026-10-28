import { afterEach, describe, expect, it, vi } from 'vitest'
import { publicOrigin } from './site-origin'

describe('publicOrigin', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('uses the site URL instead of the container address', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', 'https://whasalia.com/')
    expect(publicOrigin({ url: 'https://localhost:8080/api/channels/meta/oauth/start' })).toBe('https://whasalia.com')
  })

  it('falls back to the request origin when no site URL is set', () => {
    vi.stubEnv('NEXT_PUBLIC_SITE_URL', '')
    expect(publicOrigin({ url: 'http://localhost:3001/auth/callback' })).toBe('http://localhost:3001')
  })
})
