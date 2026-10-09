import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import type { MlConfig } from './config'
import { MlApiError, refreshTokens, type MlTokenResponse } from './client'

// Per-workspace Mercado Libre connection (portal_connections, service
// role only). Tokens are stored encrypted; access tokens last 6 hours and
// are refreshed on demand. ML refresh tokens are single-use, so the new
// one is written with a compare-and-set on the old ciphertext: if another
// process refreshed first, we re-read and use its token.

export interface MlConnectionRow {
  id: string
  workspace_id: string
  external_user_id: string
  nickname: string | null
  site_id: string | null
  access_token: string
  refresh_token: string | null
  expires_at: string | null
  status: 'active' | 'error' | 'revoked'
  last_error: string | null
  auto_import: boolean
  last_import_at: string | null
  created_at: string
}

const COLS = {
  id: true,
  workspace_id: true,
  external_user_id: true,
  nickname: true,
  site_id: true,
  access_token: true,
  refresh_token: true,
  expires_at: true,
  status: true,
  last_error: true,
  auto_import: true,
  last_import_at: true,
  created_at: true,
} as const

const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function getMlConnection(workspaceId: string): Promise<MlConnectionRow | null> {
  let data
  try {
    data = await tenantDb(workspaceId).portal_connections.findFirst({ select: COLS, where: { provider: 'mercadolibre' } })
  } catch (e) {
    throw new Error(errMsg(e))
  }
  return (data as MlConnectionRow | null) ?? null
}

const expiry = (t: MlTokenResponse) => new Date(Date.now() + Math.max(60, Number(t.expires_in) || 21600) * 1000).toISOString()

export async function saveMlConnection(
  workspaceId: string,
  tokens: MlTokenResponse,
  me: { nickname?: string | null; site_id?: string | null },
  userId: string,
): Promise<void> {
  const row = {
    workspace_id: workspaceId,
    provider: 'mercadolibre',
    external_user_id: String(tokens.user_id),
    nickname: me.nickname ?? null,
    site_id: me.site_id ?? null,
    access_token: encrypt(tokens.access_token),
    refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
    expires_at: expiry(tokens),
    scope: tokens.scope ?? null,
    status: 'active',
    last_error: null,
    connected_by: userId,
  }
  try {
    await tenantDb(workspaceId).portal_connections.upsert({
      where: { workspace_id_provider: { workspace_id: workspaceId, provider: 'mercadolibre' } },
      create: row,
      update: row,
      select: { id: true },
    })
  } catch (e) {
    throw new Error(errMsg(e))
  }
}

export async function deleteMlConnection(workspaceId: string): Promise<void> {
  try {
    await tenantDb(workspaceId).portal_connections.deleteMany({ where: { provider: 'mercadolibre' } })
  } catch (e) {
    throw new Error(errMsg(e))
  }
}

export async function markMlConnection(id: string, patch: Partial<Pick<MlConnectionRow, 'status' | 'last_error' | 'last_import_at' | 'auto_import'>>) {
  // By primary key only (callers pass just the connection id), as before.
  await prisma.portal_connections.updateMany({ where: { id }, data: patch }).catch(() => undefined)
}

const SKEW_MS = 5 * 60 * 1000

/** A valid access token for the connection, refreshing it when needed. */
export async function mlAccessToken(cfg: MlConfig, conn: MlConnectionRow, now = Date.now()): Promise<string> {
  if (conn.expires_at && new Date(conn.expires_at).getTime() - SKEW_MS > now) return decrypt(conn.access_token)
  if (!conn.refresh_token) throw new MlApiError(401, 'reconnect', 'Mercado Libre session expired; connect again')

  let tokens: MlTokenResponse
  try {
    tokens = await refreshTokens(cfg, decrypt(conn.refresh_token))
  } catch (e) {
    // Someone else may have refreshed with the same (single-use) token.
    const fresh = await getMlConnection(conn.workspace_id)
    if (fresh && fresh.refresh_token !== conn.refresh_token && fresh.expires_at && new Date(fresh.expires_at).getTime() - SKEW_MS > now) {
      return decrypt(fresh.access_token)
    }
    if (e instanceof MlApiError && (e.code === 'invalid_grant' || e.status === 400 || e.status === 401)) {
      await markMlConnection(conn.id, { status: 'error', last_error: 'reconnect' })
      throw new MlApiError(401, 'reconnect', 'Mercado Libre authorization expired or was revoked; connect again')
    }
    throw e
  }

  // Our refresh succeeded, so these are the newest tokens ML issued (a
  // concurrent refresh with the same single-use token would have failed):
  // store them unconditionally.
  try {
    await tenantDb(conn.workspace_id).portal_connections.updateMany({
      where: { id: conn.id },
      data: {
        access_token: encrypt(tokens.access_token),
        refresh_token: tokens.refresh_token ? encrypt(tokens.refresh_token) : conn.refresh_token,
        expires_at: expiry(tokens),
        status: 'active',
        last_error: null,
      },
    })
  } catch (e) {
    throw new Error(errMsg(e))
  }
  return tokens.access_token
}
