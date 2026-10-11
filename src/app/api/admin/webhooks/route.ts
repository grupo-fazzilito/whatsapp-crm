import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateWebhookSecret } from '@/lib/webhooks/signature'
import { MAX_PLATFORM_ENDPOINTS, normalizePlatformEvents } from '@/lib/webhooks/platform-events'
import { checkWebhookUrl, defaultUrlPolicy } from '@/lib/webhooks/ssrf'
import { PLATFORM_ENDPOINT_SELECT } from '@/lib/webhooks/platform'


const unauthorized = () => NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

/** GET /api/admin/webhooks — platform webhook endpoints. */
export async function GET() {
  if (!(await isPlatformAdmin())) return unauthorized()
  const endpoints = await prisma.platform_webhook_endpoints.findMany({ select: PLATFORM_ENDPOINT_SELECT, orderBy: { created_at: 'asc' } })
  return NextResponse.json({ endpoints: normalizeRaw(endpoints) })
}

/** POST {url, description?, events[]} → { endpoint, secret } (secret shown once). */
export async function POST(request: Request) {
  if (!(await isPlatformAdmin())) return unauthorized()
  const user = await getSessionUser()
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const check = checkWebhookUrl(typeof body?.url === 'string' ? body.url.trim() : '', defaultUrlPolicy())
  if (!check.ok) return NextResponse.json({ error: `url_${check.reason}` }, { status: 400 })
  const events = normalizePlatformEvents(body?.events)
  if (!events.length) return NextResponse.json({ error: 'events_required' }, { status: 400 })
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 300) || null : null
  if ((await prisma.platform_webhook_endpoints.count()) >= MAX_PLATFORM_ENDPOINTS) return NextResponse.json({ error: 'too_many_endpoints' }, { status: 409 })

  const secret = generateWebhookSecret()
  const endpoint = await prisma.platform_webhook_endpoints.create({
    data: { url: check.url.toString(), description, events, secret_encrypted: encrypt(secret), created_by: user?.id ?? null },
    select: PLATFORM_ENDPOINT_SELECT,
  })
  return NextResponse.json({ endpoint: normalizeRaw([endpoint])[0], secret }, { status: 201 })
}
