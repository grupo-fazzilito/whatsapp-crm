// Plans (table `plans`, one per workspace via workspaces.plan_id). Today there is
// one, 'free' (Free Forever); AI usage is paid apart with prepaid tokens
// (see ./pricing). Pure — safe on the client.
import { BILLABLE_ACTIONS, pricingFor, type BillableAction, type BillingSettings } from './pricing'
import { formatMoney, type Region } from '@/lib/regions'
import type { SubscriptionPricing } from './subscription-pricing'

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
  /** The visitor's sales region and its currency (every price below is in it). */
  region: Region
  currency: string
  /** Monthly token subscription (US$, every region). */
  subscription: SubscriptionPricing
  credits: {
    price: number
    minTopup: number
    packs: { amount: number; credits: number }[]
    welcome: number
    expiryMonths: number
    costs: { action: BillableAction; credits: number }[]
  }
}

export function publicPricing(settings: BillingSettings, plans: Plan[], region: Region = 'pe'): PublicPricing {
  const p = pricingFor(settings, region)
  return {
    plans,
    region,
    currency: p.currency,
    subscription: settings.subscription,
    credits: {
      price: p.credit_price,
      minTopup: p.min_topup,
      packs: p.packs.map((amount) => ({ amount, credits: Math.floor((amount + 1e-9) / p.credit_price) })),
      welcome: settings.welcome_credits,
      expiryMonths: settings.expiry_months,
      costs: BILLABLE_ACTIONS.filter((a) => a !== 'playground').map((action) => ({ action, credits: settings.action_costs[action] })),
    },
  }
}

/** "S/ 0.05", "S/ 50" — soles, as the payment page shows them. */
export function formatSoles(amount: number): string {
  return formatMoney(amount, 'PEN')
}
