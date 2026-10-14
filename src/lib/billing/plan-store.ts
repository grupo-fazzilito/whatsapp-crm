import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { FREE_PLAN_ID, planFromRow, type Plan } from './plans'

const SELECT = { id: true, name: true, price_monthly: true, currency: true, features: true } as const

/** Plans shown on the pricing page, in order. Empty if the table can't be read. */
export async function listPublicPlans(): Promise<Plan[]> {
  try {
    const rows = await prisma.plans.findMany({ where: { is_public: true, is_active: true }, select: SELECT, orderBy: { sort_order: 'asc' } })
    return rows.map(planFromRow)
  } catch (err) {
    console.error('[plans] list failed:', err instanceof Error ? err.message : err)
    return []
  }
}

/** The plan a workspace is on (falls back to the free plan). */
export async function workspacePlan(workspaceId: string): Promise<Plan> {
  const row = await prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { plans: { select: SELECT } } })
  if (row?.plans) return planFromRow(row.plans)
  const free = await prisma.plans.findUnique({ where: { id: FREE_PLAN_ID }, select: SELECT })
  return free ? planFromRow(free) : { id: FREE_PLAN_ID, name: 'Free Forever', price: 0, currency: 'PEN', features: [] }
}
