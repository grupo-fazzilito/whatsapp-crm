import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import { isUuid } from '@/lib/workspace/constants'
import { normalizePlatformEvents } from '@/lib/webhooks/platform-events'
import { checkWebhookUrl, defaultUrlPolicy } from '@/lib/webhooks/ssrf'
import { PLATFORM_ENDPOINT_SELECT } from '@/lib/webhooks/platform'

type Ctx = { params: Promise<{ id: string }> }

/** PATCH {url?, description?, events?, active?} — re-enabling resets the failure counter. */
export async function PATCH(request: Request, { params }: Ctx) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (typeof body.url === 'string') {
    const check = checkWebhookUrl(body.url, defaultUrlPolicy())
    if (!check.ok) return NextResponse.json({ error: `url_${check.reason}` }, { status: 400 })
    patch.url = check.url.toString()
  }
  if ('description' in body) patch.description = typeof body.description === 'string' ? body.description.trim().slice(0, 300) || null : null
  if ('events' in body) {
    const events = normalizePlatformEvents(body.events)
    if (!events.length) return NextResponse.json({ error: 'events_required' }, { status: 400 })
    patch.events = events
  }
  if (typeof body.active === 'boolean') {
    patch.active = body.active
    Object.assign(patch, body.active ? { failure_count: 0, disabled_at: null, disabled_reason: null } : { disabled_at: new Date(), disabled_reason: 'manual' })
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400 })
  const rows = await prisma.platform_webhook_endpoints.updateManyAndReturn({ where: { id }, data: patch, select: PLATFORM_ENDPOINT_SELECT })
  if (!rows[0]) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ endpoint: normalizeRaw(rows)[0] })
}

export async function DELETE(_request: Request, { params }: Ctx) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { count } = await prisma.platform_webhook_endpoints.deleteMany({ where: { id } })
  if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
