import 'server-only'
import type { TenantDb } from '@/lib/db/tenant'
import type { AgentInput } from './agent-input'

// AI agent CRUD for the agents screen (tenant client: one workspace only).

export async function listAgentsWithChannels(db: TenantDb) {
  const [agents, channels] = await Promise.all([
    db.ai_agents.findMany({ orderBy: { created_at: 'asc' } }),
    db.channels.findMany({ select: { id: true, name: true, type: true, ai_agent_id: true }, orderBy: { created_at: 'asc' } }),
  ])
  return { agents, channels }
}

/**
 * Keeps only transfer targets that are agents of this workspace, and a
 * handover member / team that belongs to it (else it falls back to auto).
 */
async function withValidTransfers(db: TenantDb, input: AgentInput, selfId?: string): Promise<AgentInput> {
  let out = input
  if (input.transfer_agent_ids?.length) {
    const rows = await db.ai_agents.findMany({ select: { id: true }, where: { id: { in: input.transfer_agent_ids } } })
    const ok = new Set(rows.map((r) => r.id))
    out = { ...out, transfer_agent_ids: input.transfer_agent_ids.filter((id) => ok.has(id) && id !== selfId) }
  }
  if (out.handover_user_id && !(await db.workspace_members.findFirst({ where: { user_id: out.handover_user_id, status: 'active' }, select: { id: true } }))) {
    out = { ...out, handover_user_id: null }
  }
  if (out.handover_team_id && !(await db.teams.findFirst({ where: { id: out.handover_team_id }, select: { id: true } }))) {
    out = { ...out, handover_team_id: null }
  }
  if (out.handover_mode === 'member' && 'handover_user_id' in out && !out.handover_user_id) out = { ...out, handover_mode: 'auto' }
  if (out.handover_mode === 'team' && 'handover_team_id' in out && !out.handover_team_id) out = { ...out, handover_mode: 'auto' }
  return out
}

export async function createAgent(db: TenantDb, workspaceId: string, userId: string, input: AgentInput) {
  const data = await withValidTransfers(db, input)
  return db.ai_agents.create({ data: { ...data, name: data.name!, workspace_id: workspaceId, created_by: userId } })
}

/** Null when the agent isn't in the workspace. */
export async function updateAgent(db: TenantDb, id: string, input: AgentInput) {
  const data = await withValidTransfers(db, input, id)
  const rows = await db.ai_agents.updateManyAndReturn({ where: { id }, data })
  return rows[0] ?? null
}

export async function deleteAgent(db: TenantDb, id: string): Promise<boolean> {
  const { count } = await db.ai_agents.deleteMany({ where: { id } })
  return count > 0
}
