import { describe, expect, it } from 'vitest'
import { FILE_CSP, isPdf, safeFileHeaders, sniffImage, sniffVideo } from './file-safety'

const bytes = (...parts: (number[] | string)[]) => new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)))

describe('serving files that someone else chose', () => {
  it('pages, scripts and unknown types are downloaded, never shown as the app', () => {
    for (const type of ['text/html', 'text/html; charset=utf-8', 'application/xhtml+xml', 'text/xml', 'application/javascript', 'text/plain', '', null, 'application/x-msdownload']) {
      const h = safeFileHeaders(type)
      expect(h['Content-Type']).toBe('application/octet-stream')
      expect(h['Content-Disposition']).toBe('attachment')
      expect(h['Content-Security-Policy']).toBe(FILE_CSP)
      expect(h['X-Content-Type-Options']).toBe('nosniff')
    }
  })

  it('an SVG is shown only inside a sandbox where its scripts cannot run', () => {
    const h = safeFileHeaders('image/svg+xml')
    expect(h['Content-Type']).toBe('image/svg+xml')
    expect(h['Content-Security-Policy']).toContain('sandbox')
    expect(h['Content-Security-Policy']).toContain("default-src 'none'")
  })

  it('photos, audio, video and PDF are shown inline', () => {
    expect(safeFileHeaders('image/jpeg')).toMatchObject({ 'Content-Type': 'image/jpeg', 'Content-Security-Policy': FILE_CSP })
    expect(safeFileHeaders('audio/ogg; codecs=opus')['Content-Type']).toBe('audio/ogg')
    expect(safeFileHeaders('video/mp4')['Content-Disposition']).toBeUndefined()
    const pdf = safeFileHeaders('application/pdf')
    expect(pdf['Content-Type']).toBe('application/pdf')
    expect(pdf['Content-Security-Policy']).toBeUndefined() // Chrome's viewer doesn't open sandboxed
  })

  it('a requested download name is kept and encoded', () => {
    expect(safeFileHeaders('text/html', { download: 'a"b.html' })['Content-Disposition']).toBe(`attachment; filename*=UTF-8''a%22b.html`)
  })
})

describe('the real type from the bytes', () => {
  it('images', () => {
    expect(sniffImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImage(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png')
    expect(sniffImage(bytes('GIF89a'))).toBe('image/gif')
    expect(sniffImage(bytes('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('image/webp')
    expect(sniffImage(bytes([0, 0, 0, 0x1c], 'ftypavif'))).toBe('image/avif')
  })

  it('an SVG, a web page or a PNG name on other content is not an image', () => {
    expect(sniffImage(bytes('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'))).toBeNull()
    expect(sniffImage(bytes('<?xml version="1.0"?><svg/>'))).toBeNull()
    expect(sniffImage(bytes('<html><script>alert(1)</script>'))).toBeNull()
    expect(sniffImage(bytes([0x89, 0x50, 0x4e]))).toBeNull()
    expect(sniffImage(bytes([0, 0, 0, 0x18], 'ftypisom'))).toBeNull() // an MP4
  })

  it('videos and PDF', () => {
    expect(sniffVideo(bytes([0, 0, 0, 0x18], 'ftypisom'))).toBe('video/mp4')
    expect(sniffVideo(bytes([0, 0, 0, 0x14], 'ftypqt  '))).toBe('video/quicktime')
    expect(sniffVideo(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video/webm')
    expect(sniffVideo(bytes('<svg/>'))).toBeNull()
    expect(isPdf(bytes('%PDF-1.7'))).toBe(true)
    expect(isPdf(bytes('<html>'))).toBe(false)
  })
})
