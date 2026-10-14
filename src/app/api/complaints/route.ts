import { NextResponse } from 'next/server'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { parseComplaint } from '@/lib/complaints/input'
import { fileComplaint } from '@/lib/complaints/server'

/** POST /api/complaints (public) — files a hoja de reclamación → { complaint: { code, created_at, due_date } } */
export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null
  const limit = checkRateLimit(`complaints:${ip ?? 'unknown'}`, { limit: 5, windowMs: 3600_000 })
  if (!limit.success) return rateLimitResponse(limit)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  // Honeypot: people never see this field.
  if (typeof body.website === 'string' && body.website.trim()) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const parsed = parseComplaint(body)
  if (!parsed.ok) return NextResponse.json({ error: 'invalid_fields', fields: parsed.errors }, { status: 422 })

  const c = await fileComplaint(parsed.value, { locale: body.locale === 'en' ? 'en' : 'es', ip })
  return NextResponse.json({ complaint: { code: c.code, created_at: c.created_at, due_date: c.due_date, email: c.email } }, { status: 201 })
}
