import 'server-only'
import type { LoadedChannel } from '@/lib/channels/types'

// Calling API requests with the channel's token.
//   POST /{phone-number-id}/calls     pre_accept | accept | reject | terminate
//   POST /{phone-number-id}/settings  turn calling on/off, call hours
//   GET  /{phone-number-id}?fields=messaging_limit_tier

/** Calling is recent: newer than the v21.0 used for messages. */
const GRAPH = 'https://graph.facebook.com/v24.0'

export class CallApiError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message)
    this.name = 'CallApiError'
  }
}

async function graph<T>(channel: LoadedChannel, path: string, body?: Record<string, unknown>): Promise<T> {
  const token = channel.secrets.access_token
  if (!token) throw new CallApiError('WhatsApp access token missing', 190)
  const res = await fetch(`${GRAPH}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) {
    const e = data?.error ?? {}
    throw new CallApiError(e.error_user_msg ?? e.message ?? `Meta API error: ${res.status}`, e.code ?? null)
  }
  return data as T
}

export type CallAction = 'pre_accept' | 'accept' | 'reject' | 'terminate'

export async function callAction(channel: LoadedChannel, callId: string, action: CallAction, sdp?: string): Promise<void> {
  await graph(channel, `${encodeURIComponent(channel.external_id)}/calls`, {
    messaging_product: 'whatsapp',
    call_id: callId,
    action,
    ...(sdp ? { session: { sdp_type: 'answer', sdp } } : {}),
  })
}

export async function updateCallingSettings(channel: LoadedChannel, body: Record<string, unknown>): Promise<void> {
  await graph(channel, `${encodeURIComponent(channel.external_id)}/settings`, body)
}

/** TIER_250, TIER_2K, TIER_10K, TIER_100K, TIER_UNLIMITED; null if Meta doesn't say. */
export async function messagingTier(channel: LoadedChannel): Promise<string | null> {
  const data = await graph<{ messaging_limit_tier?: string }>(channel, `${encodeURIComponent(channel.external_id)}?fields=messaging_limit_tier`)
  return data.messaging_limit_tier ?? null
}
