import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
  const { data } = await supabaseAdmin().from('profiles').select('id').eq('user_id', userId).maybeSingle()
  return (data?.id as string) ?? null
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
    const db = supabaseAdmin()
    const stage = await realEstateStage(input.workspaceId, input.key)
    if (!stage) return null

    const { data: deals } = await db
      .from('deals')
      .select('id, stage_id, assigned_to, conversation_id, stage:pipeline_stages(position)')
      .eq('workspace_id', input.workspaceId)
      .eq('pipeline_id', stage.pipelineId)
      .eq('contact_id', input.contactId)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(1)
    const deal = deals?.[0] as
      | { id: string; stage_id: string; assigned_to: string | null; conversation_id: string | null; stage: { position: number } | null }
      | undefined
    const assignee = input.assignUserId ? await profileIdOf(input.assignUserId) : null

    if (!deal) {
      if (!input.createIfMissing) return null
      const [{ data: contact }, { data: ws }] = await Promise.all([
        db.from('contacts').select('name, phone').eq('id', input.contactId).eq('workspace_id', input.workspaceId).maybeSingle(),
        db.from('workspaces').select('currency').eq('id', input.workspaceId).maybeSingle(),
      ])
      const name = (contact?.name as string) || (contact?.phone as string) || 'Cliente'
      const { data: created, error } = await db
        .from('deals')
        .insert({
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
        })
        .select('id')
        .single()
      if (error || !created) {
        console.error('[leads] deal create failed:', error?.message)
        return null
      }
      return { dealId: created.id as string, created: true, moved: true, assignedTo: assignee }
    }

    const current = deal.stage?.position ?? -1
    const forwardOnly = input.forwardOnly !== false
    const move = deal.stage_id !== stage.stageId && (!forwardOnly || stage.position > current)
    const patch: Record<string, unknown> = {}
    if (move) patch.stage_id = stage.stageId
    if (assignee && !deal.assigned_to) patch.assigned_to = assignee
    if (input.conversationId && !deal.conversation_id) patch.conversation_id = input.conversationId
    if (Object.keys(patch).length) {
      const { error } = await db.from('deals').update(patch).eq('id', deal.id).eq('workspace_id', input.workspaceId)
      if (error) {
        console.error('[leads] deal update failed:', error.message)
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
  const db = supabaseAdmin()
  const { data } = await db
    .from('deals')
    .select('assigned_to, pipeline:pipelines!inner(key)')
    .eq('workspace_id', workspaceId)
    .eq('contact_id', contactId)
    .eq('status', 'open')
    .eq('pipeline.key', 'real_estate')
    .not('assigned_to', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!data?.assigned_to) return null
  const { data: p } = await db.from('profiles').select('user_id').eq('id', data.assigned_to as string).maybeSingle()
  return (p?.user_id as string) ?? null
}
