import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import type { ChannelRow, ChannelSecrets, ChannelType, LoadedChannel } from './types'

function decryptAll(raw: Record<string, string> | null | undefined): ChannelSecrets {
  const out: ChannelSecrets = {}
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (typeof v !== 'string' || !v) continue
    try {
      out[k] = decrypt(v)
    } catch {
      // Key rotated or corrupted: leave it out so the caller reports
      // "not configured" instead of sending garbage to the provider.
    }
  }
  return out
}

async function withSecrets(row: ChannelRow | null): Promise<LoadedChannel | null> {
  if (!row) return null
  // channel_secrets has no workspace_id: the channel row already scoped it.
  const data = await prisma.channel_secrets.findUnique({ where: { channel_id: row.id }, select: { secrets: true } })
  return { ...row, secrets: decryptAll(data?.secrets as Record<string, string>) }
}

/** Channel by id, scoped to the workspace, with decrypted secrets. */
export async function loadChannel(workspaceId: string, channelId: string): Promise<LoadedChannel | null> {
  const data = await tenantDb(workspaceId).channels.findFirst({ where: { id: channelId } })
  return withSecrets(data as unknown as ChannelRow | null)
}

/** Channel an inbound webhook belongs to (provider id is globally unique per type). */
export async function findChannelByExternalId(type: ChannelType, externalId: string): Promise<LoadedChannel | null> {
  // Platform lookup: the workspace is not known yet.
  const data = await prisma.channels.findFirst({ where: { type, external_id: externalId } })
  return withSecrets(data as unknown as ChannelRow | null)
}

/** First connected channel of a type in the workspace (legacy single-number paths). */
export async function defaultChannel(workspaceId: string, type: ChannelType = 'whatsapp'): Promise<LoadedChannel | null> {
  const data = await tenantDb(workspaceId).channels.findFirst({
    where: { type },
    orderBy: [{ status: 'asc' }, { created_at: 'asc' }], // 'connected' sorts first
  })
  return withSecrets(data as unknown as ChannelRow | null)
}

/** Merge (encrypting) secrets for a channel. Empty values remove the key. */
export async function saveChannelSecrets(channelId: string, secrets: Record<string, string | null | undefined>) {
  const data = await prisma.channel_secrets.findUnique({ where: { channel_id: channelId }, select: { secrets: true } })
  const merged: Record<string, string> = { ...((data?.secrets as Record<string, string>) ?? {}) }
  for (const [k, v] of Object.entries(secrets)) {
    if (v) merged[k] = encrypt(v)
    else if (v === null) delete merged[k]
  }
  const updated_at = new Date().toISOString()
  await prisma.channel_secrets.upsert({
    where: { channel_id: channelId },
    create: { channel_id: channelId, secrets: merged, updated_at },
    update: { secrets: merged, updated_at },
  })
}
