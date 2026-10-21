// Shape of a realtime change event (same fields Supabase Realtime used).
export const REALTIME_TABLES = [
  'messages',
  'conversations',
  'conversation_tags',
  'conversation_events',
  'message_reactions',
  'notifications',
  'orders',
  'tasks',
  'bookings',
  'lead_profiles',
  'whatsapp_calls',
] as const
export type RealtimeTable = (typeof REALTIME_TABLES)[number]

export interface RealtimeChange<T = Record<string, unknown>> {
  table: RealtimeTable
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  /** Current row (empty object on DELETE). */
  new: T
  /** On DELETE: key columns of the removed row; otherwise { id }. */
  old: Partial<T>
}
