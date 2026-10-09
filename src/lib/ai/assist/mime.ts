// Media type helpers shared by the multimodal client and the media
// downloader (pure: no server imports).

export type MediaKind = 'audio' | 'image' | 'pdf'

/** "audio/ogg; codecs=opus" → "audio/ogg"; a few aliases unified. */
export function normalizeMime(mime: string | null | undefined): string {
  const base = (mime ?? '').split(';')[0].trim().toLowerCase()
  const alias: Record<string, string> = {
    'audio/x-m4a': 'audio/m4a',
    'audio/mp4a-latm': 'audio/m4a',
    'audio/x-wav': 'audio/wav',
    'audio/wave': 'audio/wav',
    'audio/vnd.wave': 'audio/wav',
    'audio/mpeg3': 'audio/mpeg',
    'audio/x-mpeg': 'audio/mpeg',
    'image/jpg': 'image/jpeg',
    'application/x-pdf': 'application/pdf',
  }
  return alias[base] ?? base
}

/** Content type from magic bytes, for servers that answer octet-stream. */
export function sniffMime(bytes: Uint8Array): string | null {
  const b = bytes
  const ascii = (from: number, len: number) => String.fromCharCode(...b.slice(from, from + len))
  if (b.length < 12) return null
  if (ascii(0, 4) === 'OggS') return 'audio/ogg'
  if (ascii(0, 4) === '%PDF') return 'application/pdf'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png'
  if (ascii(0, 4) === 'GIF8') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'audio/wav'
  if (ascii(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg'
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4)
    return brand.startsWith('M4A') ? 'audio/m4a' : brand === 'qt  ' ? 'video/quicktime' : 'audio/mp4'
  }
  if (ascii(0, 4) === 'fLaC') return 'audio/flac'
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'audio/webm'
  return null
}

/** Declared type unless it is missing / generic, then the sniffed one. */
export function resolveMime(declared: string | null | undefined, bytes: Uint8Array): string {
  const d = normalizeMime(declared)
  if (d && d !== 'application/octet-stream' && d !== 'binary/octet-stream') return d
  return sniffMime(bytes) ?? (d || 'application/octet-stream')
}

export function mediaKindOf(mime: string): MediaKind | null {
  const m = normalizeMime(mime)
  if (m === 'application/pdf') return 'pdf'
  if (m.startsWith('audio/')) return 'audio'
  // WhatsApp voice notes recorded on some phones arrive as video/ogg / video/mp4 with audio only.
  if (m === 'video/ogg') return 'audio'
  if (m.startsWith('image/')) return 'image'
  return null
}

/** File name for multipart uploads (OpenAI infers the format from it). */
export function audioFileName(mime: string): string {
  const ext: Record<string, string> = {
    'audio/ogg': 'ogg',
    'video/ogg': 'ogg',
    'audio/opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/m4a': 'm4a',
    'audio/mp4': 'm4a',
    'audio/aac': 'm4a',
    'audio/wav': 'wav',
    'audio/webm': 'webm',
    'audio/flac': 'flac',
  }
  return `audio.${ext[normalizeMime(mime)] ?? 'ogg'}`
}

/** Image types OpenAI vision accepts (PNG, JPEG, WEBP, non-animated GIF). */
export const OPENAI_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
