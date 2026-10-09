import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { normalizeRaw } from '@/lib/db/compat'
import { REAL_ESTATE_PIPELINE_KEY, type RealEstateStageKey } from './pipeline-keys'

export * from './pipeline-keys'

/**
 * Creates (once) the "Ventas inmobiliarias" pipeline with its 7 keyed
 * stages and, when the workspace has none, the real-estate lost reasons.
 * Idempotent and safe under concurrency (SQL function, migration 036).
 * Returns the pipeline id, or null when the workspace does not exist.
 */
export async function ensureRealEstatePipeline(workspaceId: string): Promise<string | null> {
  let rows: { id: string | null }[]
  try {
    rows = normalizeRaw(await prisma.$queryRaw<{ id: string | null }[]>`SELECT public.ensure_real_estate_pipeline(${workspaceId}::uuid) AS id`)
  } catch (err) {
    throw new Error(`ensure_real_estate_pipeline: ${err instanceof Error ? err.message : String(err)}`)
  }
  return rows[0]?.id ?? null
}

/** The workspace's real-estate pipeline id, or null when it was never created. */
export async function realEstatePipelineId(workspaceId: string): Promise<string | null> {
  const data = await tenantDb(workspaceId)
    .pipelines.findFirst({ select: { id: true }, where: { key: REAL_ESTATE_PIPELINE_KEY } })
    .catch(() => null)
  return data?.id ?? null
}

export interface KeyedStage {
  id: string
  pipelineId: string
  key: RealEstateStageKey
  name: string
  position: number
}

/**
 * Stage of the real-estate pipeline by its stable key (null when the
 * pipeline or that stage does not exist, e.g. the user deleted it).
 * Pass `create: true` to ensure the pipeline first.
 */
export async function realEstateStageByKey(
  workspaceId: string,
  key: RealEstateStageKey,
  opts: { create?: boolean } = {},
): Promise<KeyedStage | null> {
  const pipelineId = opts.create ? await ensureRealEstatePipeline(workspaceId) : await realEstatePipelineId(workspaceId)
  if (!pipelineId) return null
  const data = await tenantDb(workspaceId)
    .pipeline_stages.findFirst({ select: { id: true, pipeline_id: true, key: true, name: true, position: true }, where: { pipeline_id: pipelineId, key } })
    .catch(() => null)
  return data ? { id: data.id, pipelineId: data.pipeline_id, key: data.key as RealEstateStageKey, name: data.name, position: data.position } : null
}

/** All keyed stages of the real-estate pipeline, by key. */
export async function realEstateStages(workspaceId: string): Promise<Partial<Record<RealEstateStageKey, KeyedStage>>> {
  const pipelineId = await realEstatePipelineId(workspaceId)
  if (!pipelineId) return {}
  const data = await tenantDb(workspaceId)
    .pipeline_stages.findMany({ select: { id: true, pipeline_id: true, key: true, name: true, position: true }, where: { pipeline_id: pipelineId, key: { not: null } } })
    .catch(() => null)
  const out: Partial<Record<RealEstateStageKey, KeyedStage>> = {}
  for (const s of data ?? []) {
    out[s.key as RealEstateStageKey] = { id: s.id, pipelineId: s.pipeline_id, key: s.key as RealEstateStageKey, name: s.name, position: s.position }
  }
  return out
}
