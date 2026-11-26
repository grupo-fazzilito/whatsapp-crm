import 'server-only'
import { prisma } from '@/lib/db/prisma'
import type { Prisma } from '@/generated/prisma/client'
import { hasActiveSubscription } from './subscriptions'
import { BILLING_LINK } from './credits'
import { FREE_ACCOUNTS_PER_SERVICE, disconnectDate, extraChannelIds } from './accounts-model'

// Enforces the free plan's one account per service (see ./accounts-model).

/** Error code the channel routes return when the free plan's allowance is used up. */
export const PLAN_LIMIT = 'plan_limit'

/** Unlimited accounts: the plan, or a courtesy a platform admin gave the business. */
export async function unlimitedAccounts(workspaceId: string): Promise<boolean> {
  const ws = await prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { unlimited_accounts: true } })
  if (ws?.unlimited_accounts) return true
  return hasActiveSubscription(workspaceId)
}

/** Whether one more account of this service can be connected. */
export async function canAddChannel(workspaceId: string, type: string): Promise<boolean> {
  if (await unlimitedAccounts(workspaceId)) return true
  const count = await prisma.channels.count({ where: { workspace_id: workspaceId, type } })
  return count < FREE_ACCOUNTS_PER_SERVICE
}

/** What the Channels screen needs: unlimited or not, and when the extra accounts go. */
export async function accountsPlan(workspaceId: string): Promise<{ unlimited: boolean; extra_since: string | null; disconnect_on: string | null }> {
  const [unlimited, ws] = await Promise.all([
    unlimitedAccounts(workspaceId),
    prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { extra_accounts_since: true } }),
  ])
  const since = !unlimited && ws?.extra_accounts_since ? new Date(ws.extra_accounts_since) : null
  return { unlimited, extra_since: since?.toISOString() ?? null, disconnect_on: disconnectDate(since)?.toISOString() ?? null }
}

const TEXTS = {
  es: {
    warn: (date: string) => ({
      title: 'Tienes más de 1 cuenta por servicio',
      body: `El plan gratis permite 1 cuenta de cada servicio. Suscríbete antes del ${date} o las cuentas adicionales se desconectarán; la primera que conectaste de cada servicio se mantiene.`,
    }),
    done: (n: number) => ({
      title: 'Se desconectaron cuentas adicionales',
      body: `Se desconectaron ${n === 1 ? '1 cuenta' : `${n} cuentas`} porque el plan gratis permite 1 por servicio. Suscríbete al plan para volver a conectarlas.`,
    }),
  },
  en: {
    warn: (date: string) => ({
      title: 'You have more than 1 account per service',
      body: `The free plan allows 1 account of each service. Subscribe before ${date} or the extra accounts will be disconnected; the first one you connected of each service stays.`,
    }),
    done: (n: number) => ({
      title: 'Extra accounts were disconnected',
      body: `${n === 1 ? '1 account was' : `${n} accounts were`} disconnected because the free plan allows 1 per service. Subscribe to the plan to connect them again.`,
    }),
  },
}

async function notifyAdmins(workspaceId: string, text: { title: string; body: string }) {
  const admins = await prisma.workspace_members.findMany({ where: { workspace_id: workspaceId, status: 'active', role: { in: ['owner', 'admin'] } }, select: { user_id: true } })
  if (!admins.length) return
  await prisma.notifications.createMany({
    data: admins.map((a) => ({ workspace_id: workspaceId, user_id: a.user_id, type: 'billing', title: text.title, body: text.body, link: BILLING_LINK })),
  })
}

/**
 * Billing cron. For every business with more than one account of a service:
 * with unlimited accounts, nothing to do (and accounts the plan had
 * disconnected come back); on the free plan, the 30 days start (with a
 * notice) and, once over, the extra accounts are disconnected.
 */
export async function enforceAccountLimits(now = new Date()): Promise<{ warned: number; disconnected: number; restored: number }> {
  const out = { warned: 0, disconnected: 0, restored: 0 }
  // Businesses that no longer have extra accounts: their clock stops.
  await prisma.$executeRaw`UPDATE public.workspaces w SET extra_accounts_since = NULL
    WHERE w.extra_accounts_since IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.channels c WHERE c.workspace_id = w.id GROUP BY c.type HAVING COUNT(*) > ${FREE_ACCOUNTS_PER_SERVICE})`

  const rows = await prisma.$queryRaw<{ workspace_id: string }[]>`
    SELECT DISTINCT workspace_id::text AS workspace_id FROM public.channels
    GROUP BY workspace_id, type HAVING COUNT(*) > ${FREE_ACCOUNTS_PER_SERVICE}`
  for (const { workspace_id: workspaceId } of rows) {
    try {
      const channels = await prisma.channels.findMany({ where: { workspace_id: workspaceId }, select: { id: true, type: true, created_at: true, status: true, settings: true } })
      const disabled = channels.filter((c) => (c.settings as Record<string, unknown> | null)?.plan_disabled === true)
      if (await unlimitedAccounts(workspaceId)) {
        await prisma.workspaces.updateMany({ where: { id: workspaceId, extra_accounts_since: { not: null } }, data: { extra_accounts_since: null } })
        for (const c of disabled) {
          const { plan_disabled: _drop, ...settings } = (c.settings ?? {}) as Record<string, unknown>
          void _drop
          await prisma.channels.updateMany({ where: { id: c.id }, data: { status: 'connected', status_detail: null, settings: settings as Prisma.InputJsonValue, updated_at: now } })
          out.restored += 1
        }
        continue
      }
      const ws = await prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { extra_accounts_since: true, locale: true } })
      const lang = ws?.locale === 'en' ? 'en' : 'es'
      if (!ws?.extra_accounts_since) {
        const started = await prisma.workspaces.updateMany({ where: { id: workspaceId, extra_accounts_since: null }, data: { extra_accounts_since: now } })
        if (started.count) {
          const date = new Intl.DateTimeFormat(lang === 'en' ? 'en-US' : 'es-PE', { dateStyle: 'long' }).format(disconnectDate(now)!)
          await notifyAdmins(workspaceId, TEXTS[lang].warn(date))
          out.warned += 1
        }
        continue
      }
      if (disconnectDate(ws.extra_accounts_since)!.getTime() > now.getTime()) continue
      const extra = new Set(extraChannelIds(channels))
      const toDisable = channels.filter((c) => extra.has(c.id) && (c.settings as Record<string, unknown> | null)?.plan_disabled !== true)
      for (const c of toDisable) {
        await prisma.channels.updateMany({
          where: { id: c.id },
          data: {
            status: 'disconnected',
            status_detail: PLAN_LIMIT,
            settings: { ...((c.settings ?? {}) as Record<string, unknown>), plan_disabled: true } as Prisma.InputJsonValue,
            updated_at: now,
          },
        })
      }
      if (toDisable.length) {
        await notifyAdmins(workspaceId, TEXTS[lang].done(toDisable.length))
        out.disconnected += toDisable.length
      }
    } catch (err) {
      console.error(`[accounts] limit for ${workspaceId} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return out
}

/** True for an account the free plan disconnected: no messages in or out until the business subscribes. */
export function planDisabled(channel: { settings?: unknown } | null | undefined): boolean {
  return (channel?.settings as Record<string, unknown> | null | undefined)?.plan_disabled === true
}
