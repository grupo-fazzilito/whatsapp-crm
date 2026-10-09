// Capture photos ↔ storage (local driver) + publishing, on a real PostgreSQL:
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/real-estate/captures.int.test.ts
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))

// 1×1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

const pg = await pgTest()

describe.skipIf(!pg)('capture photos and publishing', async () => {
  const { displayPhotoUrls, publishCapture } = await import('./captures')
  const storage = await import('@/lib/storage')
  const { storagePathFromUrl } = await import('@/lib/storage/paths')
  let dir = ''
  let a: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let b: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'captures-'))
    process.env.STORAGE_DIR = dir
    process.env.STORAGE_DRIVER = 'local'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.test'
    a = await pg!.workspace({ businessType: 'real_estate' })
    b = await pg!.workspace({ businessType: 'real_estate' })
  })
  afterAll(async () => {
    await pg!.cleanup(a, b)
    await rm(dir, { recursive: true, force: true })
  })

  it('signs private attachment photos and passes URLs through', async () => {
    const urls = await displayPhotoUrls(['sb://attachments/ws1/captures/a.jpg', 'https://cdn.example/b.jpg', 'ftp://bad'])
    expect(urls[0]).toMatch(/^https:\/\/app\.test\/api\/files\/attachments\/ws1\/captures\/a\.jpg\?exp=\d+&sig=/)
    expect(urls.slice(1)).toEqual(['https://cdn.example/b.jpg', ''])
    const params = new URL(urls[0]).searchParams
    expect(storage.verifySignedUrl('attachments', 'ws1/captures/a.jpg', params)).toBe(true)
  })

  it('copies own photos into the public catalog when publishing (never other workspaces’)', async () => {
    const own = `${a.workspaceId}/captures/own.png`
    const foreign = `${b.workspaceId}/captures/foreign.png`
    const legacyCatalog = `${a.workspaceId}/products/legacy.png`
    await storage.uploadObject('attachments', own, PNG, 'image/png')
    await storage.uploadObject('attachments', foreign, PNG, 'image/png')
    await storage.uploadObject('catalog', legacyCatalog, PNG, 'image/png')
    const cap = await a.db.property_captures.create({
      data: {
        workspace_id: a.workspaceId,
        operation: 'sale',
        property_type: 'house',
        district: 'Miraflores',
        expected_price: 100000,
        photos: [
          `sb://attachments/${own}`,
          `sb://attachments/${foreign}`,
          `http://127.0.0.1:54321/storage/v1/object/public/catalog/${legacyCatalog}`,
        ],
      },
    })
    const res = await publishCapture(a.workspaceId, cap.id, a.userId)
    expect(res).toMatchObject({ ok: true, photosFailed: 1 })
    if (!res.ok) throw new Error('unreachable')
    const product = await a.db.products.findFirstOrThrow({ where: { id: res.productId } })
    expect(product.images).toHaveLength(2)
    for (const url of product.images) {
      expect(url).toMatch(/^https:\/\/app\.test\/api\/files\/catalog\//)
      const p = storagePathFromUrl(url, 'catalog')!
      expect(p.startsWith(`${a.workspaceId}/products/`)).toBe(true)
      expect((await storage.downloadObject('catalog', p)).contentType).toBe('image/png')
    }
    expect(await publishCapture(a.workspaceId, cap.id, a.userId)).toMatchObject({ ok: false, error: 'already_published' })
  })
})
