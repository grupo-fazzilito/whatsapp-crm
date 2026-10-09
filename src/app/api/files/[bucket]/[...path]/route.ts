import { NextResponse } from 'next/server'
import { downloadObject, StorageError, verifySignedUrl } from '@/lib/storage'
import { isBucket, PUBLIC_BUCKETS } from '@/lib/storage/paths'

/**
 * GET /api/files/<bucket>/<path> — serves stored files. Public buckets
 * (catalog, avatars) need nothing; private ones (attachments) need a valid
 * ?exp&sig from signedUrl().
 */
export async function GET(request: Request, { params }: { params: Promise<{ bucket: string; path: string[] }> }) {
  const { bucket, path: parts } = await params
  if (!isBucket(bucket) || !parts?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const objectPath = parts.map((p) => decodeURIComponent(p)).join('/')
  const search = new URL(request.url).searchParams
  const isPublic = PUBLIC_BUCKETS.has(bucket)
  if (!isPublic && !verifySignedUrl(bucket, objectPath, search)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }
  try {
    const obj = await downloadObject(bucket, objectPath)
    const headers: Record<string, string> = {
      'Content-Type': obj.contentType,
      'Content-Length': String(obj.body.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': isPublic ? 'public, max-age=86400' : 'private, max-age=300',
    }
    const dl = search.get('dl')
    if (dl) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(dl)}`
    return new Response(new Uint8Array(obj.body), { headers })
  } catch (err) {
    if (err instanceof StorageError && (err.code === 'not_found' || err.code === 'invalid')) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 })
    }
    console.error('[files] read failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
