import { permanentRedirect } from 'next/navigation'

/**
 * A public page opened with an old slug of the business moves (308) to the
 * same page at its current address. `rest` is the path after the slug.
 */
export function followSlug(requested: string, current: string, rest: string, base = '/tienda') {
  if (requested !== current) permanentRedirect(`${base}/${encodeURIComponent(current)}${rest}`)
}
