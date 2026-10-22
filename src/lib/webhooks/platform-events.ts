// Platform webhook event catalog (client-safe). Platform endpoints get every
// workspace event (with its workspace_id) plus these platform events.
// Labels live in the "platformHooks" i18n namespace: platformHooks.events.<type with . → _>.

import { WEBHOOK_EVENT_GROUPS, WEBHOOK_EVENTS } from './events'

export const PLATFORM_ONLY_EVENTS = [
  'user.signed_up',
  'workspace.created',
  'member.added',
  'ticket.created',
  'ticket.replied',
  'ticket.status_changed',
  'complaint.created',
  'payment.created',
  'payment.paid',
  'payment.failed',
  'tokens.added',
  'tokens.low',
  'tokens.depleted',
  'channel.connected',
  'channel.disconnected',
  'channel.removed',
] as const
export type PlatformOnlyEvent = (typeof PLATFORM_ONLY_EVENTS)[number]

export const PLATFORM_EVENTS = [...PLATFORM_ONLY_EVENTS, ...WEBHOOK_EVENTS] as const
export type PlatformEvent = (typeof PLATFORM_EVENTS)[number]

/** Groups for the event picker: platform groups first, then the workspace ones. */
export const PLATFORM_EVENT_GROUPS: { key: string; events: readonly string[] }[] = [
  { key: 'accounts', events: ['user.signed_up', 'workspace.created', 'member.added'] },
  { key: 'support', events: ['ticket.created', 'ticket.replied', 'ticket.status_changed', 'complaint.created'] },
  { key: 'billing', events: ['payment.created', 'payment.paid', 'payment.failed', 'tokens.added', 'tokens.low', 'tokens.depleted'] },
  { key: 'channels', events: ['channel.connected', 'channel.disconnected', 'channel.removed'] },
  ...WEBHOOK_EVENT_GROUPS,
]

/** Valid, de-duplicated subscription list ('*' = every event). */
export function normalizePlatformEvents(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  if (input.includes('*')) return ['*']
  return PLATFORM_EVENTS.filter((e) => input.includes(e))
}

export const MAX_PLATFORM_ENDPOINTS = 20
