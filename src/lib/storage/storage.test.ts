import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { storagePathFromUrl, safeFileName } from './paths'
import { pathAllowed } from './rules'

vi.mock('server-only', () => ({}))

describe('storage paths', () => {
  it('reads paths from new and legacy Supabase URLs', () => {
    expect(storagePathFromUrl('https://app.x/api/files/catalog/ws1/products/a%20b.jpg', 'catalog')).toBe('ws1/products/a b.jpg')
    expect(storagePathFromUrl('http://127.0.0.1:54321/storage/v1/object/public/catalog/ws1/p.png', 'catalog')).toBe('ws1/p.png')
    expect(storagePathFromUrl('https://x.supabase.co/storage/v1/object/sign/attachments/ws1/f.pdf?token=abc', 'attachments')).toBe('ws1/f.pdf')
    expect(storagePathFromUrl('https://app.x/api/files/attachments/ws1/f.pdf?exp=1&sig=2', 'attachments')).toBe('ws1/f.pdf')
    expect(storagePathFromUrl('https://cdn.example/other.png', 'catalog')).toBeNull()
  })
  it('safe names and namespaces', () => {
    expect(safeFileName('Fóto de pago (1).JPG')).toBe('Foto-de-pago-1-.JPG')
    const ctx = { workspaceId: 'ws1', userId: 'u1' }
    expect(pathAllowed('attachments', 'ws1/a.pdf', ctx)).toBe(true)
    expect(pathAllowed('attachments', 'ws2/a.pdf', ctx)).toBe(false)
    expect(pathAllowed('catalog', 'ws1/../ws2/a', ctx)).toBe(false)
    expect(pathAllowed('avatars', 'u1/me.png', ctx)).toBe(true)
    expect(pathAllowed('avatars', 'ws1/me.png', ctx)).toBe(false)
  })
})

describe('local driver + signed URLs', () => {
  let dir = ''
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'storage-'))
    process.env.STORAGE_DIR = dir
    process.env.STORAGE_DRIVER = 'local'
    process.env.ENCRYPTION_KEY = 'test-key'
    process.env.NEXT_PUBLIC_SITE_URL = 'https://app.test'
  })
  afterAll(() => rm(dir, { recursive: true, force: true }))

  it('upload, download, refuse overwrite, upsert, remove', async () => {
    const s = await import('./index')
    await s.uploadObject('attachments', 'ws1/a.txt', Buffer.from('hola'), 'text/plain')
    expect((await s.downloadObject('attachments', 'ws1/a.txt')).body.toString()).toBe('hola')
    await expect(s.uploadObject('attachments', 'ws1/a.txt', Buffer.from('x'), 'text/plain')).rejects.toMatchObject({ code: 'exists' })
    await s.uploadObject('attachments', 'ws1/a.txt', Buffer.from('chau'), 'text/plain', { upsert: true })
    expect((await s.downloadObject('attachments', 'ws1/a.txt')).contentType).toBe('text/plain')
    await s.removeObjects('attachments', ['ws1/a.txt'])
    await expect(s.downloadObject('attachments', 'ws1/a.txt')).rejects.toMatchObject({ code: 'not_found' })
    await expect(s.uploadObject('attachments', '../escape.txt', Buffer.from('x'), 'text/plain')).rejects.toMatchObject({ code: 'invalid' })
  })

  it('signed URLs verify, expire and bind the download name', async () => {
    const s = await import('./index')
    const url = new URL(s.signedUrl('attachments', 'ws1/f d.pdf', 60, { download: 'f.pdf' }))
    expect(url.pathname).toBe('/api/files/attachments/ws1/f%20d.pdf')
    expect(s.verifySignedUrl('attachments', 'ws1/f d.pdf', url.searchParams)).toBe(true)
    expect(s.verifySignedUrl('attachments', 'ws1/other.pdf', url.searchParams)).toBe(false)
    const tampered = new URLSearchParams(url.searchParams)
    tampered.set('dl', 'x.exe')
    expect(s.verifySignedUrl('attachments', 'ws1/f d.pdf', tampered)).toBe(false)
    expect(s.verifySignedUrl('attachments', 'ws1/f d.pdf', url.searchParams, Date.now() + 120_000)).toBe(false)
    expect(s.publicUrl('catalog', 'ws1/p.png')).toBe('https://app.test/api/files/catalog/ws1/p.png')
    expect(() => s.publicUrl('attachments', 'ws1/p.png')).toThrow()
  })
})
