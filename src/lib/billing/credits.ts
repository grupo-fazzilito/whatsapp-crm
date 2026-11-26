import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { normalizeRaw } from '@/lib/db/compat'
import { actionCost, type BillableAction } from './pricing'
import { getBillingSettings } from './settings'
import { emitPlatformEvent } from '@/lib/webhooks/platform'
import { overageRoom, topUpOverage } from './overage'

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
    if ((await creditBalance(workspaceId)) >= cost) return true
    // Subscribers get extra credits automatically, up to their limit.
    if (await addOverage(workspaceId, cost)) return true
    await notifyBilling(workspaceId, 'depleted')
    return false
  } catch (err) {
    console.error('[billing] canSpend failed (allowing):', err instanceof Error ? err.message : err)
    return true
  }
}

/** Charges an action that already happened (`times` of them). Never throws. Returns the balance after. */
export async function spend(workspaceId: string, action: BillableAction, opts: { conversationId?: string | null; times?: number; note?: string | null } = {}): Promise<number | null> {
  try {
    const settings = await getBillingSettings()
    const cost = actionCost(action, settings) * Math.max(1, Math.floor(opts.times ?? 1))
    if (cost <= 0) return null
    // The action already happened: top up first so a subscriber's extra credits pay it whole.
    if ((await creditBalance(workspaceId)) < cost) await addOverage(workspaceId, cost)
    const left = await spendCredits({ workspaceId, amount: cost, action, conversationId: opts.conversationId ?? null, partial: true, note: opts.note ?? null })
    const smallest = Math.max(1, Math.min(...Object.values(settings.action_costs).filter((c) => c > 0)))
    if (left < smallest) {
      // A subscriber under its extra limit gets more when an action needs them; anyone else is out.
      if (!(await overageRoom(workspaceId))) await notifyBilling(workspaceId, 'depleted')
    } else if (left <= settings.low_credit_threshold) await notifyBilling(workspaceId, 'low', left)
    return left
  } catch (err) {
    console.error(`[billing] spend ${action} failed:`, err instanceof Error ? err.message : err)
    return null
  }
}

/** Extra credits for a subscriber short of `needed`; tells the admins the first time a month. True when it now has enough. */
async function addOverage(workspaceId: string, needed: number): Promise<boolean> {
  try {
    const { added, first } = await topUpOverage(workspaceId, needed)
    if (first) await notifyBilling(workspaceId, 'overage')
    return added > 0
  } catch (err) {
    console.error('[billing] overage failed:', err instanceof Error ? err.message : err)
    return false
  }
}

const TEXTS = {
  es: {
    low: (n: number) => ({ title: 'Te quedan pocos créditos', body: `Quedan ${n} créditos. Con el plan, al acabarse sigue con créditos adicionales hasta tu límite de consumo extra; sin plan, la IA y las respuestas a comentarios se pausan.` }),
    depleted: () => ({ title: 'Se acabaron tus créditos', body: 'Tus agentes de IA y las respuestas a comentarios están en pausa, y los mensajes llegan a la bandeja para tu equipo. Suscríbete al plan o sube tu límite de consumo extra en Configuración → Tokens para reactivarlos.' }),
    overage: () => ({ title: 'Estás usando créditos adicionales', body: 'Se acabaron los créditos del mes y la IA sigue con créditos adicionales, hasta tu límite de consumo extra. Solo se cobra lo que uses, en tu próxima factura.' }),
    paid: (n: number) => ({ title: 'Recarga acreditada', body: `Se sumaron ${n} tokens a tu cuenta.` }),
  },
  en: {
    low: (n: number) => ({ title: 'Your credits are running low', body: `${n} credits left. With the plan, it keeps going with extra credits up to your extra usage limit; without it, the AI and comment replies pause.` }),
    depleted: () => ({ title: 'You are out of credits', body: 'Your AI agents and comment replies are paused, and messages go to your team inbox. Subscribe to the plan or raise your extra usage limit in Settings → Tokens to turn them back on.' }),
    overage: () => ({ title: 'You are using extra credits', body: "The month's credits ran out and the AI keeps going with extra credits, up to your extra usage limit. Only what you use is billed, on your next invoice." }),
    paid: (n: number) => ({ title: 'Top-up credited', body: `${n} tokens were added to your account.` }),
  },
}

/**
 * Notifies the workspace's owners/admins. 'low' and 'depleted' fire once
 * until the next top-up (marks in billing_accounts, reset by grant_credits).
 */
export async function notifyBilling(workspaceId: string, kind: 'low' | 'depleted' | 'paid' | 'overage', credits = 0): Promise<void> {
  try {
    const db = tenantDb(workspaceId)
    if (kind === 'low' || kind === 'depleted') {
      const column = kind === 'low' ? 'low_notified_at' : 'depleted_notified_at'
      await db.billing_accounts.createMany({ data: [{ workspace_id: workspaceId }], skipDuplicates: true })
      // Claim the mark atomically so concurrent replies notify once.
      const claimed = await db.billing_accounts.updateMany({
        where: { workspace_id: workspaceId, [column]: null },
        data: { [column]: new Date() },
      })
      if (!claimed.count) return
      await emitPlatformEvent(workspaceId, kind === 'low' ? 'tokens.low' : 'tokens.depleted', { balance: kind === 'low' ? credits : await creditBalance(workspaceId).catch(() => 0) })
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
