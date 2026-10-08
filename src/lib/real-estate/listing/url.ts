// Public, shareable property page: /p/<workspace slug>/<product id>.
// Safe on server and client (NEXT_PUBLIC_SITE_URL is inlined at build).

export const PROPERTY_PATH_PREFIX = '/p'

/** Absolute origin of the app, without a trailing slash. */
export function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001').replace(/\/+$/, '')
}

/** Relative path of a listing's public page. */
export function propertyPath(workspace: { slug: string }, product: { id: string }): string {
  return `${PROPERTY_PATH_PREFIX}/${encodeURIComponent(workspace.slug)}/${encodeURIComponent(product.id)}`
}

/**
 * Absolute URL of a listing's public page, for the AI and agents to send
 * (WhatsApp shows a preview with photo, title and price).
 * Only active listings of real-estate workspaces render; others 404.
 */
export function propertyUrl(workspace: { slug: string }, product: { id: string }): string {
  return siteUrl() + propertyPath(workspace, product)
}
