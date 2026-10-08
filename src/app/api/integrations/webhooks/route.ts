import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateWebhookSecret } from '@/lib/webhooks/signature'
import { ENDPOINT_FIELDS, MAX_WEBHOOK_ENDPOINTS, normalizeEvents } from '@/lib/webhooks/events'
import { checkWebhookUrl, defaultUrlPolicy } from '@/lib/webhooks/ssrf'

/** GET /api/integrations/webhooks — admins. Secrets are never returned here. */
export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { data, error } = await supabaseAdmin()
    .from('webhook_endpoints')
    .select(ENDPOINT_FIELDS)
    .eq('workspace_id', guard.ctx.workspace.id)
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ endpoints: data ?? [] })
}

/** POST {url, description?, events[]} → { endpoint, secret } (secret shown once). */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const url = typeof body?.url === 'string' ? body.url.trim() : ''
  const check = checkWebhookUrl(url, defaultUrlPolicy())
  if (!check.ok) return NextResponse.json({ error: `url_${check.reason}` }, { status: 400 })
  const events = normalizeEvents(body?.events)
  if (!events.length) return NextResponse.json({ error: 'events_required' }, { status: 400 })
  const description = typeof body?.description === 'string' ? body.description.trim().slice(0, 300) || null : null

  const db = supabaseAdmin()
  const { count } = await db.from('webhook_endpoints').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id)
  if ((count ?? 0) >= MAX_WEBHOOK_ENDPOINTS) return NextResponse.json({ error: 'too_many_endpoints' }, { status: 409 })

  const secret = generateWebhookSecret()
  const { data, error } = await db
    .from('webhook_endpoints')
    .insert({ workspace_id: workspace.id, url: check.url.toString(), description, events, secret_encrypted: encrypt(secret), created_by: user.id })
    .select(ENDPOINT_FIELDS)
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'insert_failed' }, { status: 500 })
  return NextResponse.json({ endpoint: data, secret }, { status: 201 })
}
