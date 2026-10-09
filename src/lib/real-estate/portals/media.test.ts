import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { copyImages, ownPortalPath, removeUnusedImages } from './media'
import { downloadObject, publicUrl, uploadObject } from '@/lib/storage'

describe('portal image copies (local storage driver)', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'portal-media-'))
    process.env.STORAGE_DIR = dir
    process.env.STORAGE_DRIVER = 'local'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.test'
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('recognizes our copies in new and legacy URLs', () => {
    expect(ownPortalPath('https://app.test/api/files/catalog/ws1/portals/src/abc.jpg', 'ws1')).toBe('ws1/portals/src/abc.jpg')
    expect(ownPortalPath('http://127.0.0.1:54321/storage/v1/object/public/catalog/ws1/portals/src/abc.jpg', 'ws1')).toBe('ws1/portals/src/abc.jpg')
    expect(ownPortalPath('https://app.test/api/files/catalog/ws2/portals/src/abc.jpg', 'ws1')).toBeNull()
    expect(ownPortalPath('https://app.test/api/files/catalog/ws1/products/abc.jpg', 'ws1')).toBeNull()
    expect(ownPortalPath('https://portal.example/img.jpg', 'ws1')).toBeNull()
  })

  it('keeps URLs that are already ours without downloading', async () => {
    const mine = publicUrl('catalog', 'ws1/products/a.jpg')
    const legacy = 'http://127.0.0.1:54321/storage/v1/object/public/catalog/ws1/products/b.jpg'
    const res = await copyImages('ws1', 'Portal X', [mine, legacy], [])
    expect(res).toEqual({ urls: [mine, legacy], copied: 0, failed: 0 })
  })

  it('removes only the portal copies a product dropped', async () => {
    const keep = 'ws1/portals/x/keep.jpg'
    const drop = 'ws1/portals/x/drop.jpg'
    const product = 'ws1/products/p.jpg'
    for (const p of [keep, drop, product]) await uploadObject('catalog', p, Buffer.from('i'), 'image/jpeg')
    const before = [keep, drop, product].map((p) => publicUrl('catalog', p))
    await removeUnusedImages('ws1', before, [before[0]])
    await expect(downloadObject('catalog', drop)).rejects.toThrow(/not found/)
    expect((await downloadObject('catalog', keep)).body.toString()).toBe('i')
    expect((await downloadObject('catalog', product)).body.toString()).toBe('i') // not a portal copy
  })
})
