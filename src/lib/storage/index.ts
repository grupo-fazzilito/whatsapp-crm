import 'server-only'
import crypto from 'node:crypto'
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { encodePath, PUBLIC_BUCKETS, type Bucket } from './paths'

// File storage without Supabase. Two drivers:
//   STORAGE_DRIVER=s3     any S3-compatible service (Railway Buckets, Cloudflare R2, AWS S3, MinIO):
//                         S3_ENDPOINT, S3_REGION (default auto), S3_BUCKET, S3_ACCESS_KEY_ID,
//                         S3_SECRET_ACCESS_KEY, S3_FORCE_PATH_STYLE=true for MinIO
//   STORAGE_DRIVER=local  files under STORAGE_DIR (default ./.storage) — development
// Objects are keyed "<bucket>/<path>" and always served through /api/files.

export class StorageError extends Error {
  constructor(
    message: string,
    readonly code: 'not_found' | 'exists' | 'invalid' | 'failed' = 'failed',
  ) {
    super(message)
    this.name = 'StorageError'
  }
}

interface StoredObject {
  body: Buffer
  contentType: string
}

interface Driver {
  put(key: string, body: Buffer, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  exists(key: string): Promise<boolean>
  remove(keys: string[]): Promise<void>
}

function checkKey(key: string) {
  if (!key || key.includes('..') || key.startsWith('/') || key.includes('\\') || key.includes('\0')) {
    throw new StorageError(`invalid object path: ${key}`, 'invalid')
  }
}

function localDriver(): Driver {
  const root = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.STORAGE_DIR || '.storage')
  const file = (key: string) => {
    checkKey(key)
    const full = path.resolve(/*turbopackIgnore: true*/ root, key)
    if (!full.startsWith(root + path.sep)) throw new StorageError('invalid object path', 'invalid')
    return full
  }
  return {
    async put(key, body, contentType) {
      const f = file(key)
      await mkdir(path.dirname(f), { recursive: true })
      await writeFile(f, body)
      await writeFile(`${f}.meta.json`, JSON.stringify({ contentType }))
    },
    async get(key) {
      const f = file(key)
      try {
        const body = await readFile(f)
        const meta = JSON.parse(await readFile(`${f}.meta.json`, 'utf8').catch(() => '{}')) as { contentType?: string }
        return { body, contentType: meta.contentType || 'application/octet-stream' }
      } catch {
        return null
      }
    },
    async exists(key) {
      return stat(file(key)).then(
        () => true,
        () => false,
      )
    },
    async remove(keys) {
      for (const k of keys) {
        const f = file(k)
        await rm(f, { force: true })
        await rm(`${f}.meta.json`, { force: true })
      }
    },
  }
}

function s3Driver(): Driver {
  const bucket = process.env.S3_BUCKET
  if (!bucket) throw new StorageError('S3_BUCKET is not set')
  const client = new S3Client({
    endpoint: process.env.S3_ENDPOINT || undefined,
    region: process.env.S3_REGION || 'auto',
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials:
      process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
        ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY }
        : undefined,
  })
  const notFound = (err: unknown) => {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number } }
    return e?.name === 'NoSuchKey' || e?.name === 'NotFound' || e?.$metadata?.httpStatusCode === 404
  }
  return {
    async put(key, body, contentType) {
      checkKey(key)
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }))
    },
    async get(key) {
      checkKey(key)
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
        const bytes = await out.Body?.transformToByteArray()
        return bytes ? { body: Buffer.from(bytes), contentType: out.ContentType || 'application/octet-stream' } : null
      } catch (err) {
        if (notFound(err)) return null
        throw err
      }
    },
    async exists(key) {
      checkKey(key)
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }))
        return true
      } catch (err) {
        if (notFound(err)) return false
        throw err
      }
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000)
        chunk.forEach(checkKey)
        await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }))
      }
    },
  }
}

const g = globalThis as unknown as { storageDriver?: Driver }
function driver(): Driver {
  if (!g.storageDriver) g.storageDriver = process.env.STORAGE_DRIVER === 's3' ? s3Driver() : localDriver()
  return g.storageDriver
}

const key = (bucket: Bucket, p: string) => `${bucket}/${p}`

export async function uploadObject(bucket: Bucket, p: string, body: Buffer | Uint8Array | ArrayBuffer, contentType: string, opts: { upsert?: boolean } = {}) {
  const k = key(bucket, p)
  if (!opts.upsert && (await driver().exists(k))) throw new StorageError(`already exists: ${p}`, 'exists')
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body instanceof ArrayBuffer ? new Uint8Array(body) : body)
  await driver().put(k, buf, contentType || 'application/octet-stream')
  return { path: p }
}

export async function downloadObject(bucket: Bucket, p: string): Promise<StoredObject> {
  const obj = await driver().get(key(bucket, p))
  if (!obj) throw new StorageError(`not found: ${p}`, 'not_found')
  return obj
}

export async function removeObjects(bucket: Bucket, paths: string[]) {
  if (paths.length) await driver().remove(paths.map((p) => key(bucket, p)))
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001').replace(/\/+$/, '')
}

function signingKey(): Buffer {
  const secret = process.env.STORAGE_SIGNING_SECRET || process.env.ENCRYPTION_KEY
  if (!secret) throw new StorageError('STORAGE_SIGNING_SECRET (or ENCRYPTION_KEY) is not set')
  return crypto.createHash('sha256').update(`storage-url:${secret}`).digest()
}

function signature(bucket: Bucket, p: string, exp: number, dl: string) {
  return crypto.createHmac('sha256', signingKey()).update(`${bucket}/${p}|${exp}|${dl}`).digest('base64url').slice(0, 43)
}

/** Absolute URL of an object in a public bucket (stable; safe to store and to send to Meta). */
export function publicUrl(bucket: Bucket, p: string): string {
  if (!PUBLIC_BUCKETS.has(bucket)) throw new StorageError(`${bucket} is private: use signedUrl`, 'invalid')
  return `${siteUrl()}/api/files/${bucket}/${encodePath(p)}`
}

/** Absolute, expiring URL for any object (`download` forces a file name). */
export function signedUrl(bucket: Bucket, p: string, ttlSeconds: number, opts: { download?: string } = {}): string {
  const exp = Math.floor(Date.now() / 1000) + Math.max(1, Math.floor(ttlSeconds))
  const dl = opts.download ?? ''
  const q = new URLSearchParams({ exp: String(exp), sig: signature(bucket, p, exp, dl) })
  if (dl) q.set('dl', dl)
  return `${siteUrl()}/api/files/${bucket}/${encodePath(p)}?${q}`
}

/** Checks ?exp&sig of a signed URL. */
export function verifySignedUrl(bucket: Bucket, p: string, params: URLSearchParams, now = Date.now()): boolean {
  const exp = Number(params.get('exp'))
  const sig = params.get('sig') ?? ''
  if (!Number.isFinite(exp) || exp * 1000 < now || !sig) return false
  const expected = Buffer.from(signature(bucket, p, exp, params.get('dl') ?? ''))
  const given = Buffer.from(sig)
  return expected.length === given.length && crypto.timingSafeEqual(expected, given)
}
