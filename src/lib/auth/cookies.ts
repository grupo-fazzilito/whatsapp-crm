import { NextResponse } from 'next/server'

/** Copies Set-Cookie headers from a Better Auth response onto a Next response. */
export function withAuthCookies(from: Response, to: NextResponse): NextResponse {
  for (const c of from.headers.getSetCookie()) to.headers.append('Set-Cookie', c)
  return to
}
