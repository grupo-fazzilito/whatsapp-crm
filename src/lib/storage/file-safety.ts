// What a stored or proxied file may do in the browser. Files from users and
// from customers (a document sent over WhatsApp, a photo uploaded to the
// catalog) are served from the app's own domain, so a file that is really a
// web page (HTML, SVG with <script>, XML) would run as the app: these rules
// keep files inert. Pure — no I/O.

/** Shown inline: raster images, audio, video and PDF. Everything else is downloaded. */
const INLINE = /^(image\/(jpeg|png|gif|webp|avif|heic|heif|bmp)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+|application\/pdf)$/

/** SVG is an image, but it can carry scripts: shown inline only under a sandbox. */
const SVG = 'image/svg+xml'

/**
 * Nothing in the file can run: no scripts, no requests, opaque origin.
 * Not applied to PDF: Chrome's PDF viewer doesn't open under a sandbox.
 */
export const FILE_CSP = "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'; sandbox"

function baseType(contentType: string | null | undefined): string {
  return (contentType ?? '').split(';')[0].trim().toLowerCase()
}

/** Headers for serving a file whose type came from whoever sent it. */
export function safeFileHeaders(contentType: string | null | undefined, opts: { download?: string | null } = {}): Record<string, string> {
  const type = baseType(contentType)
  const inline = INLINE.test(type) || type === SVG
  const headers: Record<string, string> = {
    'Content-Type': inline ? type : 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  }
  if (type !== 'application/pdf') headers['Content-Security-Policy'] = FILE_CSP
  if (opts.download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`
  else if (!inline) headers['Content-Disposition'] = 'attachment'
  return headers
}

/** The real type of an image from its first bytes (JPEG, PNG, GIF, WebP, AVIF/HEIC), or null. SVG is never one. */
export function sniffImage(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b.length >= 6 && ascii(b, 0, 6) in { GIF87a: 1, GIF89a: 1 }) return 'image/gif'
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp'
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12)
    if (brand === 'avif' || brand === 'avis') return 'image/avif'
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return 'image/heic'
  }
  return null
}

/** The real type of a video from its first bytes (MP4/MOV, WebM), or null. */
export function sniffVideo(b: Uint8Array): string | null {
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp') return ascii(b, 8, 10) === 'qt' ? 'video/quicktime' : 'video/mp4'
  if (b.length >= 4 && b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm'
  return null
}

export function isPdf(b: Uint8Array): boolean {
  return b.length >= 5 && ascii(b, 0, 5) === '%PDF-'
}

function ascii(b: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...b.subarray(from, to))
}
