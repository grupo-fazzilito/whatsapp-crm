import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
  const { data } = await supabaseAdmin()
    .from('channel_secrets')
    .select('secrets')
    .eq('channel_id', row.id)
    .maybeSingle()
  return { ...row, secrets: decryptAll(data?.secrets as Record<string, string>) }
}

/** Channel by id, scoped to the workspace, with decrypted secrets. */
export async function loadChannel(workspaceId: string, channelId: string): Promise<LoadedChannel | null> {
  const { data } = await supabaseAdmin()
    .from('channels')
    .select('*')
    .eq('id', channelId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  return withSecrets(data as ChannelRow | null)
}

/** Channel an inbound webhook belongs to (provider id is globally unique per type). */
export async function findChannelByExternalId(type: ChannelType, externalId: string): Promise<LoadedChannel | null> {
  const { data } = await supabaseAdmin()
    .from('channels')
    .select('*')
    .eq('type', type)
    .eq('external_id', externalId)
    .maybeSingle()
  return withSecrets(data as ChannelRow | null)
}

/** First connected channel of a type in the workspace (legacy single-number paths). */
export async function defaultChannel(workspaceId: string, type: ChannelType = 'whatsapp'): Promise<LoadedChannel | null> {
  const { data } = await supabaseAdmin()
    .from('channels')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('type', type)
    .order('status', { ascending: true }) // 'connected' sorts first
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return withSecrets(data as ChannelRow | null)
}

/** Merge (encrypting) secrets for a channel. Empty values remove the key. */
export async function saveChannelSecrets(channelId: string, secrets: Record<string, string | null | undefined>) {
  const db = supabaseAdmin()
  const { data } = await db.from('channel_secrets').select('secrets').eq('channel_id', channelId).maybeSingle()
  const merged: Record<string, string> = { ...((data?.secrets as Record<string, string>) ?? {}) }
  for (const [k, v] of Object.entries(secrets)) {
    if (v) merged[k] = encrypt(v)
    else if (v === null) delete merged[k]
  }
  const { error } = await db
    .from('channel_secrets')
    .upsert({ channel_id: channelId, secrets: merged, updated_at: new Date().toISOString() })
  if (error) throw error
}
