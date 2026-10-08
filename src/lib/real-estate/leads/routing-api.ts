import 'server-only'
import { NextResponse } from 'next/server'
import { isUuid } from '@/lib/workspace/constants'

// Shared bits of the routing-rules API routes.

export const RULE_SELECT = 'id, workspace_id, name, priority, conditions, team_id, user_id, active, created_at, updated_at'

export function ruleTarget(body: Record<string, unknown>): { team_id: string | null; user_id: string | null } | null {
  const team = typeof body.team_id === 'string' && isUuid(body.team_id) ? body.team_id : null
  const user = typeof body.user_id === 'string' && isUuid(body.user_id) ? body.user_id : null
  if (!!team === !!user) return null
  return { team_id: team, user_id: user }
}

export function ruleError(code: string | undefined, message: string | undefined) {
  if (message?.includes('team_other_workspace')) return NextResponse.json({ error: 'invalid_team' }, { status: 400 })
  if (message?.includes('user_not_member')) return NextResponse.json({ error: 'invalid_member' }, { status: 400 })
  console.error('[routing-rules] write failed:', code, message)
  return NextResponse.json({ error: 'Failed to save rule' }, { status: 500 })
}

