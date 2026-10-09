// Storage buckets and URL ↔ path helpers. Pure — safe on the client.
// Files are served by the app at /api/files/<bucket>/<path> (private
// buckets need ?exp&sig). Legacy Supabase Storage URLs
// (/storage/v1/object/{public,sign}/<bucket>/<path>) are still understood
// so data copied from Supabase keeps resolving.

export const BUCKETS = ['attachments', 'catalog', 'avatars'] as const
export type Bucket = (typeof BUCKETS)[number]
/** Readable without a signature (product photos, payment QRs, avatars). */
export const PUBLIC_BUCKETS: ReadonlySet<Bucket> = new Set(['catalog', 'avatars'])

export function isBucket(v: unknown): v is Bucket {
  return typeof v === 'string' && (BUCKETS as readonly string[]).includes(v)
}

/** Object path inside `bucket` referenced by `url` (new or legacy format), or null. */
export function storagePathFromUrl(url: string | null | undefined, bucket: Bucket): string | null {
  if (!url) return null
  let pathname: string
  try {
    pathname = new URL(url, 'http://local').pathname
  } catch {
    return null
  }
  const markers = [`/api/files/${bucket}/`, `/storage/v1/object/public/${bucket}/`, `/storage/v1/object/sign/${bucket}/`, `/storage/v1/object/authenticated/${bucket}/`]
  for (const m of markers) {
    const i = pathname.indexOf(m)
    if (i >= 0) {
      const rest = pathname.slice(i + m.length)
      if (!rest) return null
      try {
        return decodeURIComponent(rest)
      } catch {
        return null
      }
    }
  }
  return null
}

/** Encodes each path segment for use in a URL. */
export function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/')
}

/** Safe object name: keeps letters, digits, dot, dash, underscore. */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
  return (cleaned || 'file').slice(-120)
}
