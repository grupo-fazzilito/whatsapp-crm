import { afterEach, describe, expect, it, vi } from 'vitest'
import { appMode, isDevMode } from './app-mode'

afterEach(() => vi.unstubAllEnvs())

describe('appMode', () => {
  it('defaults to DEV', () => {
    vi.stubEnv('MODE', '')
    expect(appMode()).toBe('DEV')
    expect(isDevMode()).toBe(true)
  })
  it('reads PROD in any case', () => {
    vi.stubEnv('MODE', ' prod ')
    expect(appMode()).toBe('PROD')
    expect(isDevMode()).toBe(false)
  })
  it('treats unknown values as DEV', () => {
    vi.stubEnv('MODE', 'staging')
    expect(appMode()).toBe('DEV')
  })
})
