import { priorityOf, priorityRank } from './priority'
import type { Priority } from './types'

/** Top-level inbox views. All but 'resolved' hide resolved conversations; 'attention' = waiting for a person. */
export const INBOX_VIEWS = ['all', 'attention', 'mine', 'unassigned', 'resolved'] as const
export type InboxView = (typeof INBOX_VIEWS)[number]

export const SORT_MODES = ['recent', 'priority', 'waiting'] as const
export type SortMode = (typeof SORT_MODES)[number]

export type OpenStatusFilter = 'all' | 'open' | 'pending'

/** The parts of a conversation row the filters look at. */
export interface FilterableConversation {
  status: string
  channel_id?: string | null
  assigned_agent_id?: string | null
  priority?: string | null
  last_message_text?: string | null
  last_message_at?: string | null
  last_customer_message_at?: string | null
  resolved_at?: string | null
  needs_human_since?: string | null
  conversation_tags?: { id?: string; tag_id: string }[] | null
  contact?: {
    name?: string | null
    phone?: string | null
    contact_tags?: { tag_id: string }[] | null
  } | null
}

export interface ConversationFilters {
  view: InboxView
  status: OpenStatusFilter
  channelId: string | null
  /** Match any of these tags. */
  tagIds: string[]
  /** Also match tags on the contact, not only on the conversation. */
  includeContactTags: boolean
  priorities: Priority[]
  search: string
  currentUserId: string | null
}

export const DEFAULT_FILTERS: ConversationFilters = {
  view: 'all',
  status: 'all',
  channelId: null,
  tagIds: [],
  includeContactTags: false,
  priorities: [],
  search: '',
  currentUserId: null,
}

export function tagIdsOf(c: FilterableConversation, includeContactTags: boolean): string[] {
  const own = (c.conversation_tags ?? []).map((t) => t.tag_id)
  if (!includeContactTags) return own
  return [...new Set([...own, ...(c.contact?.contact_tags ?? []).map((t) => t.tag_id)])]
}

export function matchesFilters(c: FilterableConversation, f: ConversationFilters): boolean {
  const resolved = c.status === 'closed'
  if (f.view === 'resolved') {
    if (!resolved) return false
  } else {
    if (resolved) return false
    if (f.status !== 'all' && c.status !== f.status) return false
    if (f.view === 'mine' && (!f.currentUserId || c.assigned_agent_id !== f.currentUserId)) return false
    if (f.view === 'unassigned' && c.assigned_agent_id) return false
    if (f.view === 'attention' && !c.needs_human_since) return false
  }
  if (f.channelId && c.channel_id !== f.channelId) return false
  if (f.priorities.length && !f.priorities.includes(priorityOf(c.priority))) return false
  if (f.tagIds.length) {
    const tags = tagIdsOf(c, f.includeContactTags)
    if (!f.tagIds.some((id) => tags.includes(id))) return false
  }
  const q = f.search.trim().toLowerCase()
  if (q) {
    const hay = [c.contact?.name, c.contact?.phone, c.last_message_text]
      .map((s) => (s ?? '').toLowerCase())
    if (!hay.some((s) => s.includes(q))) return false
  }
  return true
}

function ts(v: string | null | undefined, fallback: number): number {
  const n = v ? Date.parse(v) : NaN
  return Number.isNaN(n) ? fallback : n
}

/**
 * recent   — latest activity first
 * priority — urgent → low, then latest activity
 * waiting  — customer waiting longest first (last customer message is
 *            newer than our last activity), then the rest by activity
 */
export function sortConversations<T extends FilterableConversation>(list: T[], mode: SortMode): T[] {
  const byRecent = (a: T, b: T) => ts(b.last_message_at, 0) - ts(a.last_message_at, 0)
  const copy = [...list]
  if (mode === 'priority') {
    return copy.sort((a, b) => priorityRank(b.priority) - priorityRank(a.priority) || byRecent(a, b))
  }
  if (mode === 'waiting') {
    const waitingSince = (c: T): number | null => {
      if (!c.last_customer_message_at) return null
      const lastIn = ts(c.last_customer_message_at, 0)
      // The customer wrote last → they're waiting since then.
      return lastIn >= ts(c.last_message_at, 0) - 1000 ? lastIn : null
    }
    return copy.sort((a, b) => {
      const wa = waitingSince(a)
      const wb = waitingSince(b)
      if (wa !== null && wb !== null) return wa - wb
      if (wa !== null) return -1
      if (wb !== null) return 1
      return byRecent(a, b)
    })
  }
  return copy.sort(byRecent)
}

export function filterAndSort<T extends FilterableConversation>(list: T[], f: ConversationFilters, mode: SortMode): T[] {
  return sortConversations(list.filter((c) => matchesFilters(c, f)), mode)
}
