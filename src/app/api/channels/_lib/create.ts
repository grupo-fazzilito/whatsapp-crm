import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { saveChannelSecrets } from '@/lib/channels/store'
import type { ChannelRow, ChannelType } from '@/lib/channels/types'
import { PUBLIC_COLUMNS, isUniqueViolation } from './shared'

export interface NewChannel {
  workspaceId: string
  userId: string
  type: ChannelType
  name: string
  purpose?: string | null
  externalId: string
  displayHandle?: string | null
  status?: 'connected' | 'disconnected' | 'error'
  statusDetail?: string | null
  settings?: Record<string, unknown>
  aiAgentId?: string | null
  secrets?: Record<string, string | null | undefined>
}

export type CreateResult =
  | { ok: true; channel: ChannelRow }
  | { ok: false; conflict: true }
  | { ok: false; conflict: false; error: string }

/** Inserts the channel (service role, explicit workspace) and its encrypted secrets. */
export async function insertChannel(input: NewChannel): Promise<CreateResult> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('channels')
    .insert({
      workspace_id: input.workspaceId,
      type: input.type,
      name: input.name,
      purpose: input.purpose ?? null,
      external_id: input.externalId,
      display_handle: input.displayHandle ?? null,
      status: input.status ?? 'connected',
      status_detail: input.statusDetail ?? null,
      settings: input.settings ?? {},
      ai_agent_id: input.aiAgentId ?? null,
      created_by: input.userId,
    })
    .select(PUBLIC_COLUMNS)
    .single()

  if (error) {
    if (isUniqueViolation(error)) return { ok: false, conflict: true }
    return { ok: false, conflict: false, error: error.message }
  }

  const channel = data as unknown as ChannelRow
  if (input.secrets && Object.values(input.secrets).some(Boolean)) {
    try {
      await saveChannelSecrets(channel.id, input.secrets)
    } catch (err) {
      // A channel without its credentials is useless: roll back.
      await db.from('channels').delete().eq('id', channel.id).eq('workspace_id', input.workspaceId)
      return { ok: false, conflict: false, error: err instanceof Error ? err.message : 'Could not save credentials' }
    }
  }
  return { ok: true, channel }
}
