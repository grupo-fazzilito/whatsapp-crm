import 'server-only'
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

// Outbound fetch for user-supplied URLs (media the AI reads):
// http(s) only, public addresses only (no loopback / private /
// link-local / metadata ranges), manual redirects re-checked, timeout
// and size cap. `allowPrivate` exists for local development only.

export class FetchBlockedError extends Error {
  constructor(public code: 'protocol' | 'private' | 'dns' | 'too_large' | 'redirects' | 'status' | 'timeout', message?: string) {
    super(message ?? code)
  }
}

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, p) => (acc << 8) + Number(p), 0) >>> 0
}

const V4_BLOCKS: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
]

export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip)
  if (kind === 4) {
    const n = v4ToInt(ip)
    return V4_BLOCKS.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
      return (n & mask) === (v4ToInt(base) & mask)
    })
  }
  if (kind === 6) {
    const s = ip.toLowerCase()
    if (s === '::' || s === '::1') return true
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(s)
    if (mapped) return isPrivateAddress(mapped[1])
    return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(s)
  }
  return true
}

async function assertPublic(url: URL, allowPrivate: boolean) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new FetchBlockedError('protocol')
  if (allowPrivate) return
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) throw new FetchBlockedError('private')
  let addrs: string[]
  if (isIP(host)) addrs = [host]
  else {
    try {
      addrs = (await lookup(host, { all: true })).map((a) => a.address)
    } catch {
      throw new FetchBlockedError('dns')
    }
  }
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new FetchBlockedError('private')
}

export interface SafeFetchResult {
  bytes: Uint8Array
  contentType: string
  finalUrl: string
}

export async function safeFetch(
  input: string,
  opts: { maxBytes: number; timeoutMs?: number; allowPrivate?: boolean; accept?: string } ,
): Promise<SafeFetchResult> {
  let url = new URL(input)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000)
  try {
    for (let hop = 0; hop < 4; hop++) {
      await assertPublic(url, !!opts.allowPrivate)
      const res = await fetch(url, {
        redirect: 'manual',
        signal: ctrl.signal,
        headers: { accept: opts.accept ?? '*/*', 'user-agent': 'Whasalia-PortalImport/1.0' },
      })
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url)
        continue
      }
      if (!res.ok) throw new FetchBlockedError('status', `HTTP ${res.status}`)
      const declared = Number(res.headers.get('content-length') ?? 0)
      if (declared > opts.maxBytes) throw new FetchBlockedError('too_large')
      const reader = res.body?.getReader()
      const chunks: Uint8Array[] = []
      let total = 0
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          total += value.byteLength
          if (total > opts.maxBytes) {
            await reader.cancel().catch(() => {})
            throw new FetchBlockedError('too_large')
          }
          chunks.push(value)
        }
      }
      const bytes = new Uint8Array(total)
      let off = 0
      for (const c of chunks) {
        bytes.set(c, off)
        off += c.byteLength
      }
      return { bytes, contentType: res.headers.get('content-type') ?? '', finalUrl: url.toString() }
    }
    throw new FetchBlockedError('redirects')
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new FetchBlockedError('timeout')
    throw e
  } finally {
    clearTimeout(timer)
  }
}

/** Decodes feed bytes honoring a charset in the content type or XML prolog (UTF-8 default). */
export function decodeText(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType)?.[1]
  const head = new TextDecoder('latin1').decode(bytes.slice(0, 200))
  const fromProlog = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]
  const charset = (fromHeader || fromProlog || 'utf-8').toLowerCase()
  try {
    return new TextDecoder(charset).decode(bytes)
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}
