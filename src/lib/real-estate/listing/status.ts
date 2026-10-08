// Listing status (products.attributes.listing_status) and small pure
// helpers shared by the catalog UI and the public property page.

export const LISTING_STATUSES = ['available', 'reserved', 'sold', 'rented'] as const
export type ListingStatus = (typeof LISTING_STATUSES)[number]

/** Statuses that hide the listing (migration 036 forces is_active=false). */
export const HIDDEN_STATUSES: ListingStatus[] = ['sold', 'rented']

/** The listing's status; missing/unknown values count as available. */
export function listingStatusOf(attrs: Record<string, unknown> | null | undefined): ListingStatus {
  const v = attrs?.listing_status
  return typeof v === 'string' && (LISTING_STATUSES as readonly string[]).includes(v) ? (v as ListingStatus) : 'available'
}

export function isHiddenStatus(status: ListingStatus): boolean {
  return HIDDEN_STATUSES.includes(status)
}

/** Tailwind classes for the status badge (AA contrast on light and dark). */
export function listingStatusTone(status: ListingStatus): string {
  switch (status) {
    case 'reserved':
      return 'bg-amber-500 text-black'
    case 'sold':
    case 'rented':
      return 'bg-slate-700 text-white'
    default:
      return 'bg-emerald-600 text-white'
  }
}

/**
 * International digits for a wa.me link. Numbers without a country code
 * get `dialCode` (the workspace country) prepended. Returns null when the
 * result is not a plausible phone number.
 */
export function waDigits(phone: string | null | undefined, dialCode?: string | null): string | null {
  const raw = (phone ?? '').trim()
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (raw.startsWith('00')) digits = digits.slice(2)
  const international = raw.startsWith('+') || raw.startsWith('00')
  if (!international && dialCode && !digits.startsWith(dialCode) && digits.length <= 10) {
    digits = dialCode + digits.replace(/^0+/, '')
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null
}

/** Click-to-chat link (official wa.me scheme) with a prefilled message. */
export function waMeLink(digits: string, text?: string): string {
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ''}`
}

/** Accepts only http(s) URLs (for video / virtual tour links). */
export function safeHttpUrl(v: unknown): string | null {
  if (typeof v !== 'string' || !v.trim()) return null
  try {
    const u = new URL(v.trim())
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null
  } catch {
    return null
  }
}
