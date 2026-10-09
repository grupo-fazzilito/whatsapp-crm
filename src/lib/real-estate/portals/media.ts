import 'server-only'
import crypto from 'crypto'
import { publicUrl, removeObjects, uploadObject } from '@/lib/storage'
import { storagePathFromUrl } from '@/lib/storage/paths'
import { safeFetch } from './net'

// Copies listing photos into our public 'catalog' bucket so links keep
// working when the portal rotates or expires them. Paths are derived
// from a hash of the source URL, so a re-import reuses what it already
// copied instead of downloading again. Bucket limits: 8 MB, jpeg / png /
// webp / gif.

const BUCKET = 'catalog' as const
const MAX_BYTES = 8 * 1024 * 1024
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const PREFIX = 'portals'

export function sourceSlug(source: string): string {
  return source.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'src'
}

const hash = (s: string) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 32)

/** Storage path of a public catalog URL (new or legacy format) that we created for portal imports. */
export function ownPortalPath(url: string, workspaceId: string): string | null {
  const path = storagePathFromUrl(url, BUCKET)
  return path && path.startsWith(`${workspaceId}/${PREFIX}/`) ? path : null
}

export interface CopyResult {
  urls: string[]
  copied: number
  failed: number
}

/**
 * Returns our URL for each source URL (same order; failed downloads are
 * skipped). `current` = the product's images today, used to skip
 * downloads already done in a previous import.
 */
export async function copyImages(
  workspaceId: string,
  source: string,
  sourceUrls: string[],
  current: string[],
  opts: { allowPrivate?: boolean } = {},
): Promise<CopyResult> {
  const slug = sourceSlug(source)
  const existing = new Set(current)
  let copied = 0
  let failed = 0
  const urls: string[] = []
  for (const src of sourceUrls) {
    // Already ours (e.g. a feed that re-exports our own URLs).
    if (ownPortalPath(src, workspaceId) || storagePathFromUrl(src, BUCKET)?.startsWith(`${workspaceId}/`)) {
      urls.push(src)
      continue
    }
    const base = `${workspaceId}/${PREFIX}/${slug}/${hash(src)}`
    const known = [...existing].find((u) => ownPortalPath(u, workspaceId)?.startsWith(base))
    if (known) {
      urls.push(known)
      continue
    }
    try {
      const res = await safeFetch(src, { maxBytes: MAX_BYTES, timeoutMs: 15_000, allowPrivate: opts.allowPrivate, accept: 'image/*' })
      const type = res.contentType.split(';')[0].trim().toLowerCase()
      const ext = EXT[type]
      if (!ext) throw new Error(`unsupported type ${type || 'unknown'}`)
      const path = `${base}.${ext}`
      await uploadObject(BUCKET, path, res.bytes, type, { upsert: true })
      urls.push(publicUrl(BUCKET, path))
      copied++
    } catch (e) {
      failed++
      console.warn('[portals] image copy failed:', src.slice(0, 200), e instanceof Error ? e.message : e)
    }
  }
  return { urls, copied, failed }
}

/** Deletes our portal copies that a product no longer uses. */
export async function removeUnusedImages(workspaceId: string, before: string[], after: string[]): Promise<void> {
  const keep = new Set(after)
  const paths = before.filter((u) => !keep.has(u)).map((u) => ownPortalPath(u, workspaceId)).filter((p): p is string => !!p)
  if (paths.length) await removeObjects(BUCKET, paths)
}
