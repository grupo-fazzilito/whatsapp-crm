import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { actionCost, type BillableAction } from './pricing'
import { getBillingSettings } from './settings'

// Credit checks and spending for AI actions. The AI asks `canSpend` before
// calling a model and `spend` once the action produced something for the
// customer/agent; spending is atomic in Postgres (spend_credits).

export const BILLING_LINK = '/settings?tab=billing'

export async function creditBalance(workspaceId: string): Promise<number> {
  const { data, error } = await supabaseAdmin().rpc('credit_balance', { ws: workspaceId })
  if (error) throw new Error(`credit_balance: ${error.message}`)
  return Number(data ?? 0)
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
    const { data, error } = await supabaseAdmin().rpc('spend_credits', {
      ws: workspaceId,
      amount: cost,
      act: action,
      conv: opts.conversationId ?? null,
      partial: true,
    })
    if (error) throw new Error(error.message)
    const left = Number(data)
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
    low: (n: number) => ({ title: 'Te quedan pocos créditos de IA', body: `Quedan ${n} créditos. Recarga para que tus agentes de IA sigan respondiendo.` }),
    depleted: () => ({ title: 'Se acabaron tus créditos de IA', body: 'Tus agentes de IA están en pausa y los mensajes llegan a la bandeja para tu equipo. Recarga créditos para reactivarlos.' }),
    paid: (n: number) => ({ title: 'Recarga acreditada', body: `Se sumaron ${n} créditos a tu cuenta.` }),
  },
  en: {
    low: (n: number) => ({ title: 'Your AI credits are running low', body: `${n} credits left. Top up so your AI agents keep replying.` }),
    depleted: () => ({ title: 'You are out of AI credits', body: 'Your AI agents are paused and messages go to your team inbox. Top up to turn them back on.' }),
    paid: (n: number) => ({ title: 'Top-up credited', body: `${n} credits were added to your account.` }),
  },
}

/**
 * Notifies the workspace's owners/admins. 'low' and 'depleted' fire once
 * until the next top-up (marks in billing_accounts, reset by grant_credits).
 */
export async function notifyBilling(workspaceId: string, kind: 'low' | 'depleted' | 'paid', credits = 0): Promise<void> {
  try {
    const db = supabaseAdmin()
    if (kind !== 'paid') {
      const column = kind === 'low' ? 'low_notified_at' : 'depleted_notified_at'
      await db.from('billing_accounts').upsert({ workspace_id: workspaceId }, { onConflict: 'workspace_id', ignoreDuplicates: true })
      // Claim the mark atomically so concurrent replies notify once.
      const { data: claimed } = await db
        .from('billing_accounts')
        .update({ [column]: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .is(column, null)
        .select('workspace_id')
      if (!claimed?.length) return
    }
    const [{ data: ws }, { data: admins }] = await Promise.all([
      db.from('workspaces').select('locale').eq('id', workspaceId).maybeSingle(),
      db.from('workspace_members').select('user_id').eq('workspace_id', workspaceId).eq('status', 'active').in('role', ['owner', 'admin']),
    ])
    const t = TEXTS[ws?.locale === 'en' ? 'en' : 'es'][kind](credits)
    if (!admins?.length) return
    const { error } = await db.from('notifications').insert(
      admins.map((a) => ({ workspace_id: workspaceId, user_id: a.user_id, type: 'billing', title: t.title, body: t.body, link: BILLING_LINK })),
    )
    if (error) console.error('[billing] notification insert failed:', error.message)
  } catch (err) {
    console.error('[billing] notify failed:', err instanceof Error ? err.message : err)
  }
}
