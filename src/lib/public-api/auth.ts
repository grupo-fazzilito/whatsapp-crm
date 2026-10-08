import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { Workspace } from '@/lib/workspace/types'
import { bearerToken, keyMatchesHash, normalizeScopes, parseApiKey, type ApiScope } from './keys'

export interface ApiContext {
  keyId: string
  keyName: string
  scopes: ApiScope[]
  /** User who created the key (used as actor where a user is required). */
  createdBy: string | null
  workspace: Workspace
}

export type AuthResult = { ok: true; ctx: ApiContext } | { ok: false; code: 'unauthorized' | 'key_revoked' | 'key_expired'; message: string }

const LAST_USED_THROTTLE_MS = 60_000

/**
 * `Authorization: Bearer cnx_live_…` → workspace context. The row is found
 * by prefix, then the full key is compared in constant time against the
 * stored SHA-256. Every later query must filter by ctx.workspace.id.
 */
export async function authenticateApiKey(request: Request): Promise<AuthResult> {
  const token = bearerToken(request.headers.get('authorization'))
  const parsed = parseApiKey(token)
  if (!token || !parsed) return { ok: false, code: 'unauthorized', message: 'Missing or malformed API key. Send "Authorization: Bearer cnx_live_…".' }

  const db = supabaseAdmin()
  const { data: rows } = await db
    .from('api_keys')
    .select('id, name, key_hash, scopes, created_by, workspace_id, last_used_at, expires_at, revoked_at')
    .eq('prefix', parsed.prefix)
    .limit(5)
  const row = (rows ?? []).find((r) => keyMatchesHash(token, r.key_hash as string))
  if (!row) return { ok: false, code: 'unauthorized', message: 'Invalid API key.' }
  if (row.revoked_at) return { ok: false, code: 'key_revoked', message: 'This API key was revoked.' }
  if (row.expires_at && new Date(row.expires_at).getTime() <= Date.now()) return { ok: false, code: 'key_expired', message: 'This API key has expired.' }

  const { data: workspace } = await db.from('workspaces').select('*').eq('id', row.workspace_id).maybeSingle()
  if (!workspace) return { ok: false, code: 'unauthorized', message: 'Invalid API key.' }

  if (!row.last_used_at || Date.now() - new Date(row.last_used_at).getTime() > LAST_USED_THROTTLE_MS) {
    void db.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', row.id).then(
      () => undefined,
      () => undefined,
    )
  }

  return {
    ok: true,
    ctx: {
      keyId: row.id,
      keyName: row.name,
      scopes: normalizeScopes(row.scopes),
      createdBy: row.created_by ?? null,
      workspace: workspace as Workspace,
    },
  }
}
