// Webhook event catalog (client-safe). Labels/descriptions live in the
// "integrations" i18n namespace: integrations.events.<type with . → _>.

export const WEBHOOK_EVENTS = [
  'message.received',
  'message.sent',
  'conversation.created',
  'conversation.assigned',
  'conversation.resolved',
  'contact.created',
  'contact.updated',
  'order.created',
  'order.status_changed',
  'order.paid',
  'booking.created',
  'booking.status_changed',
  'lead.qualified',
  'deal.stage_changed',
] as const
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]

/** Groups for the event picker. */
export const WEBHOOK_EVENT_GROUPS: { key: string; events: WebhookEvent[] }[] = [
  { key: 'messages', events: ['message.received', 'message.sent'] },
  { key: 'conversations', events: ['conversation.created', 'conversation.assigned', 'conversation.resolved'] },
  { key: 'contacts', events: ['contact.created', 'contact.updated'] },
  { key: 'orders', events: ['order.created', 'order.status_changed', 'order.paid'] },
  { key: 'bookings', events: ['booking.created', 'booking.status_changed'] },
  { key: 'crm', events: ['lead.qualified', 'deal.stage_changed'] },
]

export function isWebhookEvent(v: unknown): v is WebhookEvent {
  return typeof v === 'string' && (WEBHOOK_EVENTS as readonly string[]).includes(v)
}

/** Valid, de-duplicated subscription list ('*' = every event). */
export function normalizeEvents(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  if (input.includes('*')) return ['*']
  return WEBHOOK_EVENTS.filter((e) => input.includes(e))
}

export function eventI18nKey(type: string): string {
  return type.replace(/\./g, '_')
}

export const WEBHOOK_HEADERS = {
  event: 'X-Whasalia-Event',
  delivery: 'X-Whasalia-Delivery',
  signature: 'X-Whasalia-Signature',
} as const

/** Max endpoints per workspace. */
export const MAX_WEBHOOK_ENDPOINTS = 20

/** Columns of webhook_endpoints safe to return to the settings UI (no secret). */
export const ENDPOINT_FIELDS =
  'id, url, description, events, active, failure_count, disabled_at, disabled_reason, last_success_at, last_failure_at, created_at, updated_at'
