// Dashboard widget catalog. Pure — used by the page (client) and the
// layout API (server) to validate what can be shown to whom.

export const WIDGET_IDS = [
  'tokens',
  'connected_accounts',
  'conversations_handled',
  'new_leads',
  'active_conversations',
  'unanswered',
  'messages_today',
  'first_response',
  'ai_today',
  'open_deals',
  'tasks_due',
  'bookings_today',
  'orders_today',
  'hot_leads',
  'meta_free_replies',
  'channel_breakdown',
  'conversations_chart',
  'pipeline_chart',
  'response_time_chart',
  'activity',
  'quick_actions',
] as const
export type WidgetId = (typeof WIDGET_IDS)[number]

export type WidgetSize = 'sm' | 'md' | 'lg'
export type WidgetCategory = 'account' | 'attention' | 'sales' | 'ai' | 'team'

export interface WidgetDef {
  id: WidgetId
  size: WidgetSize
  category: WidgetCategory
  /** Only owners/admins (money, platform limits). */
  admin?: boolean
  /** Needs an enabled business module. */
  requires?: 'bookings' | 'orders'
  /** Only for this industry. */
  industry?: string
}

export const WIDGETS: Record<WidgetId, WidgetDef> = {
  tokens: { id: 'tokens', size: 'sm', category: 'account', admin: true },
  connected_accounts: { id: 'connected_accounts', size: 'md', category: 'account' },
  conversations_handled: { id: 'conversations_handled', size: 'sm', category: 'attention' },
  new_leads: { id: 'new_leads', size: 'sm', category: 'sales' },
  active_conversations: { id: 'active_conversations', size: 'sm', category: 'attention' },
  unanswered: { id: 'unanswered', size: 'sm', category: 'attention' },
  messages_today: { id: 'messages_today', size: 'sm', category: 'attention' },
  first_response: { id: 'first_response', size: 'sm', category: 'team' },
  ai_today: { id: 'ai_today', size: 'sm', category: 'ai' },
  open_deals: { id: 'open_deals', size: 'sm', category: 'sales' },
  tasks_due: { id: 'tasks_due', size: 'sm', category: 'team' },
  bookings_today: { id: 'bookings_today', size: 'md', category: 'sales', requires: 'bookings' },
  orders_today: { id: 'orders_today', size: 'sm', category: 'sales', requires: 'orders' },
  hot_leads: { id: 'hot_leads', size: 'sm', category: 'sales', industry: 'real_estate' },
  meta_free_replies: { id: 'meta_free_replies', size: 'md', category: 'account', admin: true },
  channel_breakdown: { id: 'channel_breakdown', size: 'md', category: 'attention' },
  conversations_chart: { id: 'conversations_chart', size: 'lg', category: 'attention' },
  pipeline_chart: { id: 'pipeline_chart', size: 'md', category: 'sales' },
  response_time_chart: { id: 'response_time_chart', size: 'lg', category: 'team' },
  activity: { id: 'activity', size: 'lg', category: 'team' },
  quick_actions: { id: 'quick_actions', size: 'lg', category: 'team' },
}

/** Simple number widgets served by GET /api/dashboard/widgets. */
export const KPI_WIDGETS: WidgetId[] = [
  'conversations_handled',
  'new_leads',
  'active_conversations',
  'unanswered',
  'messages_today',
  'first_response',
  'ai_today',
  'open_deals',
  'tasks_due',
  'bookings_today',
  'orders_today',
  'hot_leads',
  'channel_breakdown',
]

export interface WidgetContext {
  isAdmin: boolean
  modules: Partial<Record<'bookings' | 'orders', boolean>>
  industry: string | null | undefined
}

export function widgetAvailable(id: WidgetId, ctx: WidgetContext): boolean {
  const w = WIDGETS[id]
  if (!w) return false
  if (w.admin && !ctx.isAdmin) return false
  if (w.requires && !ctx.modules[w.requires]) return false
  if (w.industry && w.industry !== ctx.industry) return false
  return true
}

/** Starting layout for a user who never customized the dashboard. */
export function defaultLayout(ctx: WidgetContext): WidgetId[] {
  const base: WidgetId[] = [
    'tokens',
    'conversations_handled',
    'new_leads',
    'unanswered',
    'ai_today',
    'orders_today',
    'hot_leads',
    'bookings_today',
    'connected_accounts',
    'conversations_chart',
    'pipeline_chart',
    'channel_breakdown',
    'activity',
  ]
  return base.filter((id) => widgetAvailable(id, ctx))
}

/** Keeps known, allowed, unique widget ids (max 30), in order. */
export function sanitizeLayout(raw: unknown, ctx: WidgetContext): WidgetId[] {
  if (!Array.isArray(raw)) return defaultLayout(ctx)
  const out: WidgetId[] = []
  for (const x of raw) {
    if (typeof x !== 'string' || !(WIDGET_IDS as readonly string[]).includes(x)) continue
    const id = x as WidgetId
    if (!out.includes(id) && widgetAvailable(id, ctx)) out.push(id)
    if (out.length >= 30) break
  }
  return out
}
