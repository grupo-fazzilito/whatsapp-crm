import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchMetaProfile } from './meta-messaging'

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }))

describe('fetchMetaProfile', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('Messenger: first and last name', async () => {
    const fetchMock = reply(200, { first_name: 'Ana', last_name: 'Pérez', id: '1' })
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchMetaProfile('messenger', 'tok', 'PSID1')).toEqual({ name: 'Ana Pérez', handle: null })
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toContain('/PSID1?fields=first_name,last_name')
  })

  it('Instagram: name and username, or the username alone', async () => {
    vi.stubGlobal('fetch', reply(200, { name: 'Ana', username: 'ana.pe' }))
    expect(await fetchMetaProfile('instagram', 'tok', 'IG1')).toEqual({ name: 'Ana', handle: 'ana.pe' })
    vi.stubGlobal('fetch', reply(200, { username: 'ana.pe' }))
    expect(await fetchMetaProfile('instagram', 'tok', 'IG1')).toEqual({ name: null, handle: 'ana.pe' })
  })

  it('null when Meta refuses or fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal('fetch', reply(400, { error: { message: 'Unsupported get request' } }))
    expect(await fetchMetaProfile('messenger', 'tok', 'PSID1')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network') }))
    expect(await fetchMetaProfile('instagram', 'tok', 'IG1')).toBeNull()
  })
})
