// Super admin notifications (platform_notifications, filled by the
// platform_notify() SQL function on every platform event). Pure.

/** Event types that can notify, in the order the settings list them. */
export const ADMIN_NOTIFICATION_TYPES = [
  'user.signed_up',
  'workspace.created',
  'ticket.created',
  'ticket.replied',
  'complaint.created',
  'payment.paid',
  'payment.failed',
  'tokens.depleted',
  'tokens.low',
  'channel.connected',
] as const
export type AdminNotificationType = (typeof ADMIN_NOTIFICATION_TYPES)[number]

/** Off unless turned on (same default as platform_notify()). */
export const DEFAULT_DISABLED: AdminNotificationType[] = ['tokens.low']

export const isAdminNotificationType = (v: unknown): v is AdminNotificationType =>
  typeof v === 'string' && (ADMIN_NOTIFICATION_TYPES as readonly string[]).includes(v)

/** platform_settings 'admin_notifications' → the disabled types. */
export function disabledTypes(value: unknown): AdminNotificationType[] {
  const list = (value as { disabled?: unknown } | null)?.disabled
  return Array.isArray(list) ? list.filter(isAdminNotificationType) : DEFAULT_DISABLED
}

/** Where a notification leads in the admin panel. */
export function notificationLink(type: string): string {
  if (type.startsWith('ticket.')) return '/admin-panel/support'
  if (type === 'complaint.created') return '/admin-panel/complaints'
  if (type.startsWith('payment.') || type.startsWith('tokens.')) return '/admin-panel/billing'
  return '/admin-panel/clients'
}

const str = (v: unknown) => (typeof v === 'string' && v ? v : '')

/** Values for the notification's text (business, person, amount…). */
export function notificationVars(type: string, data: Record<string, unknown>, workspaceName: string | null): Record<string, string> {
  const get = (path: string[]) => path.reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), data)
  const business = workspaceName || str(get(['payment', 'workspace_name'])) || str(get(['ticket', 'workspace_name'])) || str(get(['workspace', 'name']))
  const amount = get(['payment', 'amount'])
  return {
    business: business || '—',
    name: str(get(['user', 'name'])) || str(get(['user', 'email'])) || str(get(['complaint', 'consumer_name'])),
    email: str(get(['user', 'email'])) || str(get(['ticket', 'user_email'])) || str(get(['complaint', 'email'])),
    subject: str(get(['ticket', 'subject'])),
    number: String(get(['ticket', 'number']) ?? get(['complaint', 'number']) ?? ''),
    amount: amount === undefined || amount === null ? '' : `${amount} ${str(get(['payment', 'currency']))}`.trim(),
    tokens: String(get(['payment', 'credits']) ?? ''),
    channel: str(get(['channel', 'type'])),
    balance: String(get(['balance']) ?? ''),
  }
}
