import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateWebhookSecret } from '@/lib/webhooks/signature'
import { MAX_WEBHOOK_ENDPOINTS, normalizeEvents } from '@/lib/webhooks/events'
import { checkWebhookUrl, defaultUrlPolicy } from '@/lib/webhooks/ssrf'

/** Columns of ENDPOINT_FIELDS (secrets are never returned). */
const ENDPOINT_SELECT = {
  id: true,
  url: true,
  description: true,
  events: true,
  active: true,
  failure_count: true,
  disabled_at: true,
  disabled_reason: true,
  last_success_at: true,
  last_failure_at: true,
  created_at: true,
  updated_at: true,
} as const

/** GET /api/integrations/webhooks — admins. Secrets are never returned here. */
export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  try {
    const data = await guard.ctx.db.webhook_endpoints.findMany({
      select: ENDPOINT_SELECT,
      where: { workspace_id: guard.ctx.workspace.id },
      orderBy: { created_at: 'asc' },
    })
    return NextResponse.json({ endpoints: data })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
}

/** POST {url, description?, events[]} → { endpoint, secret } (secret shown once). */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user, db } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  const check = checkWebhookUrl(url, defaultUrlPolicy())
  if (!check.ok) return NextResponse.json({ error: `url_${check.reason}` }, { status: 400 })
  const events = normalizeEvents(body?.events)
  if (!events.length) return NextResponse.json({ error: 'events_required' }, { status: 400 })
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 300) || null : null

  const count = await db.webhook_endpoints.count({ where: { workspace_id: workspace.id } }).catch(() => null)
  if ((count ?? 0) >= MAX_WEBHOOK_ENDPOINTS) return NextResponse.json({ error: 'too_many_endpoints' }, { status: 409 })

  const secret = generateWebhookSecret()
  let data
  try {
    data = await db.webhook_endpoints.create({
      data: { workspace_id: workspace.id, url: check.url.toString(), description, events, secret_encrypted: encrypt(secret), created_by: user.id },
      select: ENDPOINT_SELECT,
    })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) || 'insert_failed' }, { status: 500 })
  }
  return NextResponse.json({ endpoint: data, secret }, { status: 201 })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
