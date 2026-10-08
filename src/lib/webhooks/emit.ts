import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { WebhookEvent } from './events'

/**
 * Queues `type` for every active endpoint of the workspace subscribed to
 * it (public.webhook_emit → webhook_deliveries). One fast insert, no
 * network: the automations cron delivers. Never throws.
 *
 * Most events are emitted by database triggers (migration 041) so every
 * write path is covered; use this for events that only exist in app code.
 */
export async function emitEvent(workspaceId: string, type: WebhookEvent | 'ping', data: Record<string, unknown>): Promise<number> {
  try {
    const { data: queued, error } = await supabaseAdmin().rpc('webhook_emit', {
      p_workspace: workspaceId,
      p_type: type,
      p_data: data,
    })
    if (error) throw error
    return Number(queued ?? 0)
  } catch (err) {
    console.error(`[webhooks] emit ${type} failed:`, err instanceof Error ? err.message : err)
    return 0
  }
}
