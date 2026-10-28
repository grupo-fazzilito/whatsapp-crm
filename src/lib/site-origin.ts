/**
 * Public origin for redirects and OAuth callbacks. Behind Railway's proxy
 * `request.url` is the container's address (https://localhost:8080), so the
 * configured site URL wins; the request origin is only a local fallback.
 */
export function publicOrigin(request: { url: string }): string {
  const site = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '')
  return site || new URL(request.url).origin
}
