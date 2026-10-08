import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { generateApiKey, normalizeScopes } from '@/lib/public-api/keys'

const MAX_KEYS = 50

/** GET /api/integrations/api-keys — admins. Never returns secrets or hashes. */
export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .select('id, name, prefix, scopes, created_by, last_used_at, expires_at, revoked_at, created_at')
    .eq('workspace_id', guard.ctx.workspace.id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keys: data ?? [] })
}

/**
 * POST /api/integrations/api-keys {name, scopes[], expires_in_days?}
 * → { key, secret } — the secret is returned only here, once.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : ''
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const scopes = normalizeScopes(body?.scopes)
  if (!scopes.length) return NextResponse.json({ error: 'scopes_required' }, { status: 400 })
  const days = Number(body?.expires_in_days ?? 0)
  if (!Number.isFinite(days) || days < 0 || days > 3650) return NextResponse.json({ error: 'invalid_expiry' }, { status: 400 })

  const db = supabaseAdmin()
  const { count } = await db.from('api_keys').select('id', { count: 'exact', head: true }).eq('workspace_id', workspace.id).is('revoked_at', null)
  if ((count ?? 0) >= MAX_KEYS) return NextResponse.json({ error: 'too_many_keys' }, { status: 409 })

  const generated = generateApiKey()
  const { data, error } = await db
    .from('api_keys')
    .insert({
      workspace_id: workspace.id,
      name,
      prefix: generated.prefix,
      key_hash: generated.hash,
      scopes,
      created_by: user.id,
      expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
    })
    .select('id, name, prefix, scopes, created_by, last_used_at, expires_at, revoked_at, created_at')
    .single()
  if (error || !data) return NextResponse.json({ error: error?.message ?? 'insert_failed' }, { status: 500 })
  return NextResponse.json({ key: data, secret: generated.secret }, { status: 201 })
}
