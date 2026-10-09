import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { realEstateStageByKey, type RealEstateStageKey } from '@/lib/real-estate/pipeline'

// Deals of the real-estate sales pipeline (migration 036: pipelines.key =
// 'real_estate', stages keyed new → qualified → viewing_scheduled →
// viewed → negotiation → reservation → won), moved by stage key.

export type StageKey = RealEstateStageKey

export interface StageRef {
  pipelineId: string
  stageId: string
  position: number
}

/** Stage `key` of the workspace's real-estate pipeline (created if missing). */
export async function realEstateStage(workspaceId: string, key: StageKey): Promise<StageRef | null> {
  try {
    const stage = await realEstateStageByKey(workspaceId, key, { create: true })
    return stage ? { pipelineId: stage.pipelineId, stageId: stage.id, position: stage.position } : null
  } catch (err) {
    console.error('[leads] real-estate pipeline unavailable:', err instanceof Error ? err.message : err)
    return null
  }
}

/** profiles.id of a user (deals.assigned_to references profiles). */
export async function profileIdOf(userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  // profiles has no workspace: platform client.
  const data = await prisma.profiles.findFirst({ select: { id: true }, where: { user_id: userId } }).catch(() => null)
  return data?.id ?? null
}

export interface MoveDealInput {
  workspaceId: string
  contactId: string
  conversationId?: string | null
  key: StageKey
  /** Create "Lead — {name}" when the contact has no open deal in the pipeline. */
  createIfMissing?: boolean
  /** Only move forward (never back from a later stage). Default true. */
  forwardOnly?: boolean
  value?: number | null
  currency?: string | null
  /** Member to own the deal (only set when the deal has no owner). */
  assignUserId?: string | null
}

export interface MoveDealResult {
  dealId: string
  created: boolean
  moved: boolean
  assignedTo: string | null
}

/**
 * Moves the contact's open deal of the real-estate pipeline to stage
 * `key` (creating it when asked). Never throws; null when nothing done.
 */
export async function moveContactDeal(input: MoveDealInput): Promise<MoveDealResult | null> {
  try {
    const db = tenantDb(input.workspaceId)
    const stage = await realEstateStage(input.workspaceId, input.key)
    if (!stage) return null

    const found = await db.deals
      .findFirst({
        select: { id: true, stage_id: true, assigned_to: true, conversation_id: true, pipeline_stages: { select: { position: true } } },
        where: { pipeline_id: stage.pipelineId, contact_id: input.contactId, status: 'open' },
        orderBy: { created_at: 'desc' },
      })
      .catch(() => null)
    const deal = found ? { ...found, stage: found.pipeline_stages } : undefined
    const assignee = input.assignUserId ? await profileIdOf(input.assignUserId) : null

    if (!deal) {
      if (!input.createIfMissing) return null
      const [contact, ws] = await Promise.all([
        db.contacts.findFirst({ select: { name: true, phone: true }, where: { id: input.contactId } }).catch(() => null),
        db.workspaces.findFirst({ select: { currency: true }, where: { id: input.workspaceId } }).catch(() => null),
      ])
      const name = (contact?.name as string) || (contact?.phone as string) || 'Cliente'
      let created: { id: string }
      try {
        created = await db.deals.create({
          data: {
            workspace_id: input.workspaceId,
            pipeline_id: stage.pipelineId,
            stage_id: stage.stageId,
            contact_id: input.contactId,
            conversation_id: input.conversationId ?? null,
            title: `Lead — ${name}`.slice(0, 200),
            value: input.value && input.value > 0 ? input.value : 0,
            currency: input.currency || (ws?.currency as string) || 'USD',
            assigned_to: assignee,
            status: 'open',
          },
          select: { id: true },
        })
      } catch (err) {
        console.error('[leads] deal create failed:', err instanceof Error ? err.message : err)
        return null
      }
      return { dealId: created.id, created: true, moved: true, assignedTo: assignee }
    }

    const current = deal.stage?.position ?? -1
    const forwardOnly = input.forwardOnly !== false
    const move = deal.stage_id !== stage.stageId && (!forwardOnly || stage.position > current)
    const patch: Record<string, unknown> = {}
    if (move) patch.stage_id = stage.stageId
    if (assignee && !deal.assigned_to) patch.assigned_to = assignee
    if (input.conversationId && !deal.conversation_id) patch.conversation_id = input.conversationId
    if (Object.keys(patch).length) {
      try {
        await db.deals.updateMany({ where: { id: deal.id }, data: patch })
      } catch (err) {
        console.error('[leads] deal update failed:', err instanceof Error ? err.message : err)
        return null
      }
    }
    return { dealId: deal.id, created: false, moved: move, assignedTo: (patch.assigned_to as string) ?? deal.assigned_to }
  } catch (err) {
    console.error('[leads] moveContactDeal failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** user_id behind a deal's assigned_to (profiles.id). */
export async function dealOwnerUserId(workspaceId: string, contactId: string): Promise<string | null> {
  const data = await tenantDb(workspaceId)
    .deals.findFirst({
      select: { assigned_to: true },
      where: { contact_id: contactId, status: 'open', pipelines: { key: 'real_estate' }, assigned_to: { not: null } },
      orderBy: { created_at: 'desc' },
    })
    .catch(() => null)
  if (!data?.assigned_to) return null
  // profiles has no workspace: platform client.
  const p = await prisma.profiles.findFirst({ select: { user_id: true }, where: { id: data.assigned_to } }).catch(() => null)
  return p?.user_id ?? null
}
