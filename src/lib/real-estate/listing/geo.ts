// Map helpers without API keys: OpenStreetMap embeds and Google Maps links.

export interface LatLng {
  lat: number
  lng: number
}

export function isValidLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
  )
}

/** Coordinates from attribute values (numbers or numeric strings), or null. */
export function coordsFrom(attrs: Record<string, unknown> | null | undefined): LatLng | null {
  const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(',', '.')) : NaN)
  const lat = num(attrs?.latitude)
  const lng = num(attrs?.longitude)
  return isValidLatLng(lat, lng) ? { lat, lng } : null
}

const PAIR = /(-?\d{1,3}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/

/**
 * Extracts coordinates from a pasted Google Maps / OpenStreetMap link or a
 * plain "lat, lng" pair. Supports `!3d<lat>!4d<lng>` (exact pin), `@lat,lng`,
 * `q=`/`query=`/`ll=`/`destination=` and OSM `mlat`/`mlon` or `#map=z/lat/lng`.
 */
export function parseCoordinates(input: string): LatLng | null {
  const text = (input ?? '').trim()
  if (!text) return null
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    /* keep raw */
  }
  const tryPair = (a: string | undefined, b: string | undefined): LatLng | null => {
    const lat = Number(a)
    const lng = Number(b)
    return isValidLatLng(lat, lng) ? { lat, lng } : null
  }

  const pin = decoded.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/)
  if (pin) return tryPair(pin[1], pin[2])

  const mlat = decoded.match(/[?&]mlat=(-?\d+(?:\.\d+)?)/)
  const mlon = decoded.match(/[?&]mlon=(-?\d+(?:\.\d+)?)/)
  if (mlat && mlon) return tryPair(mlat[1], mlon[1])

  const osmHash = decoded.match(/#map=\d+\/(-?\d+(?:\.\d+)?)\/(-?\d+(?:\.\d+)?)/)
  if (osmHash) return tryPair(osmHash[1], osmHash[2])

  const param = decoded.match(/[?&](?:q|query|ll|destination|center)=\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (param) return tryPair(param[1], param[2])

  const at = decoded.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/)
  if (at) return tryPair(at[1], at[2])

  if (!/^https?:/i.test(decoded)) {
    const pair = decoded.match(PAIR)
    if (pair) return tryPair(pair[1], pair[2])
  }
  return null
}

const round = (n: number, d = 6) => Number(n.toFixed(d))

/** OpenStreetMap embeddable map (iframe src) centered on the point, with a marker. */
export function osmEmbedUrl({ lat, lng }: LatLng, span = 0.006): string {
  const bbox = [round(lng - span), round(lat - span / 2), round(lng + span), round(lat + span / 2)].join(',')
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${round(lat)}%2C${round(lng)}`
}

/** Full OpenStreetMap page for the point. */
export function osmLink({ lat, lng }: LatLng, zoom = 17): string {
  return `https://www.openstreetmap.org/?mlat=${round(lat)}&mlon=${round(lng)}#map=${zoom}/${round(lat)}/${round(lng)}`
}

/** Google Maps search link (official URL scheme, no key) for a point or an address. */
export function googleMapsUrl(target: LatLng | string): string {
  const q = typeof target === 'string' ? target.trim() : `${round(target.lat)},${round(target.lng)}`
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`
}
