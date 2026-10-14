import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
const { isPrivateAddress } = await import('./safe-fetch')

describe('outbound URL guard', () => {
  it('blocks private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '190.12.34.56', '2800:200::1']) expect(isPrivateAddress(ip), ip).toBe(false)
  })
})
