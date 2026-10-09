'use client'

// Browser helpers for /api/files (replaces supabase.storage in components).
import type { Bucket } from './paths'

export async function uploadFile(
  bucket: Bucket,
  file: File | Blob,
  opts: { path?: string; folder?: string; upsert?: boolean; fileName?: string } = {},
): Promise<{ path: string; url: string }> {
  const form = new FormData()
  form.set('bucket', bucket)
  form.set('file', file, opts.fileName ?? (file instanceof File ? file.name : 'file'))
  if (opts.path) form.set('path', opts.path)
  if (opts.folder) form.set('folder', opts.folder)
  if (opts.upsert) form.set('upsert', 'true')
  const res = await fetch('/api/files/upload', { method: 'POST', body: form })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `upload failed (${res.status})`)
  return body as { path: string; url: string }
}

export async function signFiles(bucket: Bucket, paths: string[], opts: { expiresIn?: number; download?: string } = {}): Promise<Record<string, string>> {
  if (!paths.length) return {}
  const res = await fetch('/api/files/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, paths, expires_in: opts.expiresIn, download: opts.download }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `sign failed (${res.status})`)
  return (body as { urls: Record<string, string> }).urls
}

export async function signFile(bucket: Bucket, path: string, opts: { expiresIn?: number; download?: string } = {}): Promise<string | null> {
  const urls = await signFiles(bucket, [path], opts).catch(() => ({}) as Record<string, string>)
  return urls[path] ?? null
}
