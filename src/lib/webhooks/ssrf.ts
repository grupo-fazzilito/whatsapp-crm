import { BlockList, isIP } from 'net'
import { lookup as dnsLookup, type LookupAddress } from 'dns'

// SSRF protection for webhook URLs.
// - Only https:// (http:// to localhost is allowed outside production so
//   developers can test against a local receiver).
// - No credentials in the URL, only ports 80/443/8000-65535 for http(s).
// - The host must resolve only to public addresses. The check runs inside
//   the HTTP client's DNS lookup, so the address that is checked is the
//   address that is connected to (no DNS-rebinding window).

const blocked = new BlockList()
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv4')
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(net, prefix, 'ipv6')
}

const LOOPBACK_V4 = new BlockList()
LOOPBACK_V4.addSubnet('127.0.0.0', 8, 'ipv4')

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
}

/** IPv4-mapped / NAT64-embedded IPv6 → the embedded IPv4, else null. */
function embeddedV4(ip: string): string | null {
  const m = /^(?:::ffff:|::ffff:0:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  if (m) return m[1]
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(ip)
  if (hex) {
    const a = parseInt(hex[1], 16)
    const b = parseInt(hex[2], 16)
    return `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`
  }
  return null
}

/** True for loopback, private, link-local, CGNAT, multicast, reserved... */
export function isPrivateAddress(ip: string): boolean {
  const addr = stripBrackets(ip.trim())
  const family = isIP(addr)
  if (family === 4) return blocked.check(addr, 'ipv4')
  if (family === 6) {
    const v4 = embeddedV4(addr)
    if (v4) return blocked.check(v4, 'ipv4')
    return blocked.check(addr, 'ipv6')
  }
  return true // not an IP at all: refuse
}

export function isLoopbackAddress(ip: string): boolean {
  const addr = stripBrackets(ip.trim())
  if (addr === '::1') return true
  const v4 = isIP(addr) === 6 ? embeddedV4(addr) : addr
  return !!v4 && isIP(v4) === 4 && LOOPBACK_V4.check(v4, 'ipv4')
}

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost'])

export interface UrlPolicy {
  /** Allow http(s) to localhost / 127.0.0.1 / ::1 (development only). */
  allowLoopback: boolean
}

export function defaultUrlPolicy(): UrlPolicy {
  return { allowLoopback: process.env.NODE_ENV !== 'production' }
}

export type UrlCheck = { ok: true; url: URL; loopback: boolean } | { ok: false; reason: 'invalid_url' | 'https_required' | 'credentials' | 'port' | 'private_address' | 'host' }

/** Static checks (no DNS). Run on save and again before every delivery. */
export function checkWebhookUrl(raw: string, policy: UrlPolicy): UrlCheck {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'invalid_url' }
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false, reason: 'invalid_url' }
  if (url.username || url.password) return { ok: false, reason: 'credentials' }
  const host = stripBrackets(url.hostname.toLowerCase())
  if (!host || host.endsWith('.')) return { ok: false, reason: 'host' }
  const loopback = LOCAL_HOSTNAMES.has(host) || host.endsWith('.localhost') || (isIP(host) !== 0 && isLoopbackAddress(host))
  if (loopback) {
    if (!policy.allowLoopback) return { ok: false, reason: 'private_address' }
    return { ok: true, url, loopback: true }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'https_required' }
  if (url.port && Number(url.port) !== 443 && Number(url.port) < 1024) return { ok: false, reason: 'port' }
  if (isIP(host) !== 0 && isPrivateAddress(host)) return { ok: false, reason: 'private_address' }
  // Single-label names (intranet hosts) and internal TLDs.
  if (isIP(host) === 0 && (!host.includes('.') || /\.(local|internal|lan|home|corp|intranet)$/.test(host))) {
    return { ok: false, reason: 'host' }
  }
  return { ok: true, url, loopback: false }
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void

/**
 * `lookup` for http(s).request: resolves like dns.lookup and refuses any
 * private address (loopback only when allowed).
 */
export function guardedLookup(allowLoopback: boolean) {
  return (hostname: string, options: object, callback: LookupCallback) => {
    dnsLookup(hostname, { ...(options as object), all: true }, (err, addresses) => {
      if (err) return callback(err, [])
      const list = (addresses as LookupAddress[]) ?? []
      const bad = list.find((a) => isPrivateAddress(a.address) && !(allowLoopback && isLoopbackAddress(a.address)))
      if (!list.length || bad) {
        const e = new Error(`Refusing to connect to private address ${bad?.address ?? hostname}`) as NodeJS.ErrnoException
        e.code = 'ESSRF'
        return callback(e, [])
      }
      if ((options as { all?: boolean }).all) return callback(null, list)
      callback(null, list[0].address, list[0].family)
    })
  }
}
