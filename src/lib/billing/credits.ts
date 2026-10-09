import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { normalizeRaw } from '@/lib/db/compat'
import { actionCost, type BillableAction } from './pricing'
import { getBillingSettings } from './settings'

// Credit checks and spending for AI actions. The AI asks `canSpend` before
// calling a model and `spend` once the action produced something for the
// customer/agent; spending is atomic in Postgres (spend_credits).

export const BILLING_LINK = '/settings?tab=billing'

function rpcError(fn: string, err: unknown): Error {
  return new Error(`${fn}: ${err instanceof Error ? err.message : String(err)}`)
}

export async function creditBalance(workspaceId: string): Promise<number> {
  try {
    const [row] = normalizeRaw(await prisma.$queryRaw<{ v: number | null }[]>`SELECT public.credit_balance(${workspaceId}::uuid) AS v`)
    return Number(row?.v ?? 0)
  } catch (err) {
    throw rpcError('credit_balance', err)
  }
}

/**
 * spend_credits(): atomic FIFO spend over the live lots. Returns the
 * balance after (or -1 when `partial` is false and the balance is short).
 */
export async function spendCredits(input: {
  workspaceId: string
  amount: number
  action: string
  conversationId?: string | null
  partial?: boolean
  note?: string | null
  actorId?: string | null
}): Promise<number> {
  const [row] = normalizeRaw(
    await prisma.$queryRaw<{ v: number | null }[]>`SELECT public.spend_credits(
      ${input.workspaceId}::uuid, ${input.amount}::int, ${input.action}::text,
      ${input.conversationId ?? null}::uuid, ${input.partial ?? true}::boolean,
      ${input.note ?? null}::text, ${input.actorId ?? null}::uuid) AS v`,
  )
  return Number(row?.v)
}

/** grant_credits(): new credit lot + ledger row; re-arms low/depleted notices. Returns the lot id. */
export async function grantCredits(input: {
  workspaceId: string
  amount: number
  source: string
  expiresAt: string | Date
  paymentId?: string | null
  note?: string | null
  actorId?: string | null
}): Promise<string | null> {
  const expires = input.expiresAt instanceof Date ? input.expiresAt.toISOString() : input.expiresAt
  const [row] = await prisma.$queryRaw<{ v: string | null }[]>`SELECT public.grant_credits(
    ${input.workspaceId}::uuid, ${input.amount}::int, ${input.source}::text, ${expires}::timestamptz,
    ${input.paymentId ?? null}::uuid, ${input.note ?? null}::text, ${input.actorId ?? null}::uuid) AS v`
  return row?.v ?? null
}

/**
 * True when the workspace may run this action now. Fails open on DB
 * errors (a billing hiccup must not silence every AI agent) and when the
 * platform turned enforcement off.
 */
export async function canSpend(workspaceId: string, action: BillableAction): Promise<boolean> {
  try {
    const settings = await getBillingSettings()
    const cost = actionCost(action, settings)
    if (!settings.enforce || cost <= 0) return true
    const ok = (await creditBalance(workspaceId)) >= cost
    if (!ok) await notifyBilling(workspaceId, 'depleted')
    return ok
  } catch (err) {
    console.error('[billing] canSpend failed (allowing):', err instanceof Error ? err.message : err)
    return true
  }
}

/** Charges an action that already happened. Never throws. Returns the balance after. */
export async function spend(workspaceId: string, action: BillableAction, opts: { conversationId?: string | null } = {}): Promise<number | null> {
  try {
    const settings = await getBillingSettings()
    const cost = actionCost(action, settings)
    if (cost <= 0) return null
    const left = await spendCredits({ workspaceId, amount: cost, action, conversationId: opts.conversationId ?? null, partial: true })
    if (left < Math.max(1, Math.min(...Object.values(settings.action_costs).filter((c) => c > 0)))) await notifyBilling(workspaceId, 'depleted')
    else if (left <= settings.low_credit_threshold) await notifyBilling(workspaceId, 'low', left)
    return left
  } catch (err) {
    console.error(`[billing] spend ${action} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

const TEXTS = {
  es: {
    low: (n: number) => ({ title: 'Te quedan pocos tokens de IA', body: `Quedan ${n} tokens. Recarga para que tus agentes de IA sigan respondiendo.` }),
    depleted: () => ({ title: 'Se acabaron tus tokens de IA', body: 'Tus agentes de IA están en pausa y los mensajes llegan a la bandeja para tu equipo. Recarga tokens para reactivarlos.' }),
    paid: (n: number) => ({ title: 'Recarga acreditada', body: `Se sumaron ${n} tokens a tu cuenta.` }),
  },
  en: {
    low: (n: number) => ({ title: 'Your AI tokens are running low', body: `${n} tokens left. Top up so your AI agents keep replying.` }),
    depleted: () => ({ title: 'You are out of AI tokens', body: 'Your AI agents are paused and messages go to your team inbox. Top up to turn them back on.' }),
    paid: (n: number) => ({ title: 'Top-up credited', body: `${n} tokens were added to your account.` }),
  },
}

/**
 * Notifies the workspace's owners/admins. 'low' and 'depleted' fire once
 * until the next top-up (marks in billing_accounts, reset by grant_credits).
 */
export async function notifyBilling(workspaceId: string, kind: 'low' | 'depleted' | 'paid', credits = 0): Promise<void> {
  try {
    const db = tenantDb(workspaceId)
    if (kind !== 'paid') {
      const column = kind === 'low' ? 'low_notified_at' : 'depleted_notified_at'
      await db.billing_accounts.createMany({ data: [{ workspace_id: workspaceId }], skipDuplicates: true })
      // Claim the mark atomically so concurrent replies notify once.
      const claimed = await db.billing_accounts.updateMany({
        where: { workspace_id: workspaceId, [column]: null },
        data: { [column]: new Date() },
      })
      if (!claimed.count) return
    }
    const [ws, admins] = await Promise.all([
      db.workspaces.findFirst({ where: { id: workspaceId }, select: { locale: true } }),
      db.workspace_members.findMany({ where: { status: 'active', role: { in: ['owner', 'admin'] } }, select: { user_id: true } }),
    ])
    const t = TEXTS[ws?.locale === 'en' ? 'en' : 'es'][kind](credits)
    if (!admins.length) return
    try {
      await db.notifications.createMany({
        data: admins.map((a) => ({ workspace_id: workspaceId, user_id: a.user_id, type: 'billing', title: t.title, body: t.body, link: BILLING_LINK })),
      })
    } catch (err) {
      console.error('[billing] notification insert failed:', err instanceof Error ? err.message : err)
    }
  } catch (err) {
    console.error('[billing] notify failed:', err instanceof Error ? err.message : err)
  }
}
