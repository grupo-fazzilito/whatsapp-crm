import 'server-only'
import { NextResponse } from 'next/server'
import { checkRateLimit, type RateLimitResult } from '@/lib/rate-limit'
import { authenticateApiKey, type ApiContext } from './auth'
import { hasScope, scopeHint, type ApiAccess, type ApiResource } from './keys'
import { ApiError, badRequest } from './errors'

export { ApiError, badRequest, notFound, unprocessable } from './errors'

// Response helpers + the route wrapper for /api/v1.
// Error shape (always): { "error": { "code": "...", "message": "..." } }

export const API_RATE_LIMIT = { limit: 120, windowMs: 60_000 } as const
/** Unauthenticated attempts per IP (bad / missing keys). */
const AUTH_FAIL_LIMIT = { limit: 30, windowMs: 60_000 } as const

export function apiError(status: number, code: string, message: string, extra?: { headers?: HeadersInit; details?: Record<string, unknown> }) {
  return NextResponse.json(
    { error: { code, message, ...(extra?.details ? { details: extra.details } : {}) } },
    { status, headers: extra?.headers },
  )
}

function rateHeaders(r: RateLimitResult): Record<string, string> {
  return {
    'X-RateLimit-Limit': String(r.limit),
    'X-RateLimit-Remaining': String(r.remaining),
    'X-RateLimit-Reset': String(Math.ceil(r.reset / 1000)),
  }
}

function clientIp(request: Request): string {
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
}

export interface ApiHandlerArgs<P> {
  request: Request
  ctx: ApiContext
  params: P
  url: URL
}

/**
 * Wraps a v1 handler: API key auth, scope check, per-key rate limit,
 * JSON errors (ApiError → its status, anything else → 500).
 */
export function apiRoute<P = Record<string, never>>(
  scope: { resource: ApiResource; access: ApiAccess } | null,
  handler: (args: ApiHandlerArgs<P>) => Promise<unknown>,
  opts: { status?: number } = {},
) {
  return async (request: Request, routeCtx?: { params?: Promise<P> }): Promise<Response> => {
    const auth = await authenticateApiKey(request)
    if (!auth.ok) {
      const ipLimit = checkRateLimit(`v1-authfail:${clientIp(request)}`, AUTH_FAIL_LIMIT)
      if (!ipLimit.success) return tooMany(ipLimit)
      return apiError(401, auth.code, auth.message, { headers: { 'WWW-Authenticate': 'Bearer realm="api"' } })
    }
    const limit = checkRateLimit(`v1:${auth.ctx.keyId}`, API_RATE_LIMIT)
    if (!limit.success) return tooMany(limit)
    const headers = rateHeaders(limit)

    if (scope && !hasScope(auth.ctx.scopes, scope.resource, scope.access)) {
      return apiError(403, 'insufficient_scope', `This API key lacks the required scope (${scopeHint(scope.resource, scope.access)}).`, { headers })
    }

    try {
      const params = ((await routeCtx?.params) ?? {}) as P
      const body = await handler({ request, ctx: auth.ctx, params, url: new URL(request.url) })
      if (body instanceof Response) {
        for (const [k, v] of Object.entries(headers)) body.headers.set(k, v)
        return body
      }
      return NextResponse.json(body, { status: opts.status ?? 200, headers })
    } catch (err) {
      if (err instanceof ApiError) return apiError(err.status, err.code, err.message, { headers, details: err.details })
      if (err instanceof Error && ['invalid_cursor', 'invalid_limit', 'invalid_date'].includes(err.message)) {
        return apiError(400, err.message, err.message === 'invalid_cursor' ? 'The cursor is invalid or expired.' : err.message === 'invalid_limit' ? 'limit must be an integer between 1 and 100.' : 'Dates must be ISO 8601 (e.g. 2026-10-08T15:00:00Z).', { headers })
      }
      console.error('[api/v1] unhandled error:', err)
      return apiError(500, 'internal_error', 'Something went wrong. Try again later.', { headers })
    }
  }
}

function tooMany(r: RateLimitResult) {
  const retryAfter = Math.max(1, Math.ceil((r.reset - Date.now()) / 1000))
  return apiError(429, 'rate_limited', `Too many requests. Retry in ${retryAfter}s.`, {
    headers: { 'Retry-After': String(retryAfter), ...rateHeaders(r) },
  })
}

/** Parses a JSON object body or throws 400. */
export async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw badRequest('Body must be a JSON object.')
  return body as Record<string, unknown>
}
