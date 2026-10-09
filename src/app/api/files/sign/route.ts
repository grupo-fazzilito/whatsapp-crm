import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { signedUrl } from '@/lib/storage'
import { isBucket } from '@/lib/storage/paths'
import { pathAllowed } from '@/lib/storage/rules'

/**
 * POST /api/files/sign { bucket, paths: string[], expires_in?: seconds (≤ 7 days), download?: file name }
 * → { urls: { [path]: url } }. Only paths in the caller's namespace.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const ctx = { workspaceId: guard.ctx.workspace.id, userId: guard.ctx.user.id }
  const body = (await request.json().catch(() => null)) as { bucket?: unknown; paths?: unknown; expires_in?: unknown; download?: unknown } | null
  if (!body || !isBucket(body.bucket) || !Array.isArray(body.paths) || body.paths.length === 0 || body.paths.length > 200) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  }
  const bucket = body.bucket
  const ttl = Math.min(Math.max(Number(body.expires_in) || 3600, 60), 7 * 86400)
  const download = typeof body.download === 'string' && body.download ? body.download.slice(0, 200) : undefined
  const urls: Record<string, string> = {}
  for (const p of body.paths) {
    if (typeof p !== 'string' || !pathAllowed(bucket, p, ctx)) return NextResponse.json({ error: 'forbidden_path', path: p }, { status: 403 })
    urls[p] = signedUrl(bucket, p, ttl, { download })
  }
  return NextResponse.json({ urls })
}
