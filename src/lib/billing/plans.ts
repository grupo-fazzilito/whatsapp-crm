// Plans (table `plans`, one per workspace via workspaces.plan_id). Today there is
// one, 'free' (Free Forever); AI usage is paid apart with prepaid tokens
// (see ./pricing). Pure — safe on the client.
import { BILLABLE_ACTIONS, type BillableAction, type BillingSettings } from './pricing'

export const FREE_PLAN_ID = 'free'

/** A row of the plans table, as the client sees it. */
export interface Plan {
  id: string
  /** Shown as is in every language. */
  name: string
  /** Monthly price (0 = free). */
  price: number
  currency: string
  /** i18n keys under mktPlans.features. */
  features: string[]
}

export function planFromRow(row: { id: string; name: string; price_monthly: unknown; currency: string; features: unknown }): Plan {
  return {
    id: row.id,
    name: row.name,
    price: Number(row.price_monthly) || 0,
    currency: row.currency,
    features: Array.isArray(row.features) ? row.features.filter((f): f is string => typeof f === 'string') : [],
  }
}

/** What the public pricing needs from the billing settings (no secrets). */
export interface PublicPricing {
  plans: Plan[]
  credits: {
    price: number
    minTopup: number
    packs: { amount: number; credits: number }[]
    welcome: number
    expiryMonths: number
    costs: { action: BillableAction; credits: number }[]
  }
}

export function publicPricing(settings: BillingSettings, plans: Plan[]): PublicPricing {
  return {
    plans,
    credits: {
      price: settings.credit_price,
      minTopup: settings.min_topup,
      packs: settings.packs.map((amount) => ({ amount, credits: Math.floor((amount + 1e-9) / settings.credit_price) })),
      welcome: settings.welcome_credits,
      expiryMonths: settings.expiry_months,
      costs: BILLABLE_ACTIONS.filter((a) => a !== 'playground').map((action) => ({ action, credits: settings.action_costs[action] })),
    },
  }
}

/** "S/ 0.05", "S/ 50" — soles, as the payment page shows them. */
export function formatSoles(amount: number): string {
  const decimals = Number.isInteger(amount) ? 0 : Math.max(2, Math.min(4, (String(amount).split('.')[1] ?? '').length))
  return `S/ ${amount.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}
