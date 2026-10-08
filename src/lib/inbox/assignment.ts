import { isUuid } from '@/lib/workspace/constants'
import type { InboxSettings } from './types'

export interface AssignCandidate {
  user_id: string
  available: boolean
  last_assigned_at: string | null
}

/**
 * Round-robin pick: available members only, least recently assigned
 * first (never-assigned members first of all), ties by user id so the
 * choice is deterministic.
 */
export function pickRoundRobin(candidates: AssignCandidate[], exclude: string[] = []): string | null {
  const pool = candidates.filter((c) => c.available && !exclude.includes(c.user_id))
  if (!pool.length) return null
  pool.sort((a, b) => {
    const ta = a.last_assigned_at ? Date.parse(a.last_assigned_at) : -Infinity
    const tb = b.last_assigned_at ? Date.parse(b.last_assigned_at) : -Infinity
    if (ta !== tb) return ta < tb ? -1 : 1
    return a.user_id < b.user_id ? -1 : a.user_id > b.user_id ? 1 : 0
  })
  return pool[0].user_id
}

/** workspaces.settings.inbox with defaults. */
export function parseInboxSettings(settings: unknown): InboxSettings {
  const inbox = ((settings as Record<string, unknown> | null | undefined)?.inbox ?? {}) as Record<string, unknown>
  return {
    auto_assign: inbox.auto_assign === 'round_robin' ? 'round_robin' : 'off',
    default_team_id: typeof inbox.default_team_id === 'string' && isUuid(inbox.default_team_id) ? inbox.default_team_id : null,
  }
}
