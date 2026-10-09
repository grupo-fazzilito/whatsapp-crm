import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { generateApiKey, normalizeScopes } from '@/lib/public-api/keys'

const MAX_KEYS = 50

const KEY_SELECT = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  created_by: true,
  last_used_at: true,
  expires_at: true,
  revoked_at: true,
  created_at: true,
} as const

/** GET /api/integrations/api-keys — admins. Never returns secrets or hashes. */
export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  try {
    const data = await guard.ctx.db.api_keys.findMany({
      select: KEY_SELECT,
      where: { workspace_id: guard.ctx.workspace.id },
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ keys: data })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) }, { status: 500 })
  }
}

/**
 * POST /api/integrations/api-keys {name, scopes[], expires_in_days?}
 * → { key, secret } — the secret is returned only here, once.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user, db } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : ''
  if (!name) return NextResponse.json({ error: 'name_required' }, { status: 400 })
  const scopes = normalizeScopes(body?.scopes)
  if (!scopes.length) return NextResponse.json({ error: 'scopes_required' }, { status: 400 })
  const days = Number(body?.expires_in_days ?? 0)
  if (!Number.isFinite(days) || days < 0 || days > 3650) return NextResponse.json({ error: 'invalid_expiry' }, { status: 400 })

  const count = await db.api_keys.count({ where: { workspace_id: workspace.id, revoked_at: null } }).catch(() => null)
  if ((count ?? 0) >= MAX_KEYS) return NextResponse.json({ error: 'too_many_keys' }, { status: 409 })

  const generated = generateApiKey()
  let data
  try {
    data = await db.api_keys.create({
      data: {
        workspace_id: workspace.id,
        name,
        prefix: generated.prefix,
        key_hash: generated.hash,
        scopes,
        created_by: user.id,
        expires_at: days ? new Date(Date.now() + days * 86_400_000).toISOString() : null,
      },
      select: KEY_SELECT,
    })
  } catch (error) {
    return NextResponse.json({ error: errMessage(error) || 'insert_failed' }, { status: 500 })
  }
  return NextResponse.json({ key: data, secret: generated.secret }, { status: 201 })
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
