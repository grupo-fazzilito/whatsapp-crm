import 'server-only'

/** Visitor IP behind Railway's proxy (x-real-ip holds only the client). */
export function visitorIp(req: Request): string {
  return req.headers.get('x-real-ip') || req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}
