import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { publicUrl, signedUrl, StorageError, uploadObject } from '@/lib/storage'
import { isBucket, PUBLIC_BUCKETS, safeFileName } from '@/lib/storage/paths'
import { ownerPrefix, pathAllowed, UPLOAD_LIMITS } from '@/lib/storage/rules'

/**
 * POST /api/files/upload (multipart): file, bucket, and either path (inside
 * the caller's namespace: <workspace id>/… or, for avatars, <user id>/…)
 * or folder (a random name is generated). Optional upsert=true.
 * → { path, url } — url is public for catalog/avatars, signed (1 h) for attachments.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const ctx = { workspaceId: guard.ctx.workspace.id, userId: guard.ctx.user.id }

  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  const bucket = form?.get('bucket')
  if (!(file instanceof File) || !isBucket(bucket)) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const limits = UPLOAD_LIMITS[bucket]
  if (file.size === 0 || file.size > limits.maxBytes) return NextResponse.json({ error: 'file_too_large', max_bytes: limits.maxBytes }, { status: 413 })
  if (limits.imagesOnly && !file.type.startsWith('image/')) return NextResponse.json({ error: 'images_only' }, { status: 415 })

  const given = form?.get('path')
  const folder = String(form?.get('folder') ?? 'uploads').replace(/[^A-Za-z0-9/_-]/g, '').replace(/^\/+|\/+$/g, '') || 'uploads'
  const objectPath = typeof given === 'string' && given ? given : `${ownerPrefix(bucket, ctx)}${folder}/${randomUUID()}-${safeFileName(file.name)}`
  if (!pathAllowed(bucket, objectPath, ctx)) return NextResponse.json({ error: 'forbidden_path' }, { status: 403 })

  try {
    await uploadObject(bucket, objectPath, Buffer.from(await file.arrayBuffer()), file.type || 'application/octet-stream', {
      upsert: form?.get('upsert') === 'true',
    })
  } catch (err) {
    if (err instanceof StorageError && err.code === 'exists') return NextResponse.json({ error: 'exists' }, { status: 409 })
    console.error('[files] upload failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'upload_failed' }, { status: 500 })
  }
  const url = PUBLIC_BUCKETS.has(bucket) ? publicUrl(bucket, objectPath) : signedUrl(bucket, objectPath, 3600)
  return NextResponse.json({ path: objectPath, url })
}
