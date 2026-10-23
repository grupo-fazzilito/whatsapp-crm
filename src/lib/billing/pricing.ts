// Prepaid AI credits: prices and rules edited in the admin panel
// (platform_settings 'billing'). Pure — safe in tests and on the client.

/** Billable actions (AI, and automatic comment replies) and what each one costs in credits. */
export const BILLABLE_ACTIONS = ['reply', 'followup', 'summary', 'suggest', 'transcription', 'vision', 'comment_reply', 'reminder', 'playground'] as const
export type BillableAction = (typeof BILLABLE_ACTIONS)[number]

export interface BillingSettings {
  /** Soles per credit (1 credit = 1 AI reply by default). */
  credit_price: number
  /** Minimum top-up in soles (whole soles). */
  min_topup: number
  /** Suggested packs in soles, shown as buttons. */
  packs: number[]
  /** Months until purchased credits expire. */
  expiry_months: number
  /** Credits given to every new workspace. */
  welcome_credits: number
  /** Notify admins when the balance drops to this many credits. */
  low_credit_threshold: number
  /** Credits per action. */
  action_costs: Record<BillableAction, number>
  /** false = meter only, never pause the AI (e.g. while testing). */
  enforce: boolean
}

export const DEFAULT_BILLING: BillingSettings = {
  credit_price: 0.05,
  min_topup: 50,
  packs: [50, 100, 200, 500],
  expiry_months: 6,
  welcome_credits: 100,
  low_credit_threshold: 50,
  action_costs: { reply: 1, followup: 1, summary: 1, suggest: 1, transcription: 2, vision: 2, comment_reply: 1, reminder: 1, playground: 1 },
  enforce: true,
}

const num = (v: unknown, min: number, max: number, fallback: number, int = false): number => {
  const n = typeof v === 'string' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) return fallback
  return int ? Math.round(n) : n
}

/** Merge stored values over the defaults, dropping anything out of range. */
export function normalizeBilling(stored: Partial<BillingSettings> | null | undefined): BillingSettings {
  const s = stored ?? {}
  const min_topup = num(s.min_topup, 1, 100_000, DEFAULT_BILLING.min_topup, true)
  const packs = Array.isArray(s.packs)
    ? [...new Set(s.packs.map((p) => num(p, min_topup, 100_000, 0, true)).filter((p) => p > 0))].sort((a, b) => a - b).slice(0, 6)
    : DEFAULT_BILLING.packs.filter((p) => p >= min_topup)
  const costs = { ...DEFAULT_BILLING.action_costs }
  for (const a of BILLABLE_ACTIONS) costs[a] = num(s.action_costs?.[a], 0, 1000, DEFAULT_BILLING.action_costs[a], true)
  return {
    credit_price: num(s.credit_price, 0.0001, 1000, DEFAULT_BILLING.credit_price),
    min_topup,
    packs: packs.length ? packs : [min_topup],
    expiry_months: num(s.expiry_months, 1, 60, DEFAULT_BILLING.expiry_months, true),
    welcome_credits: num(s.welcome_credits, 0, 1_000_000, DEFAULT_BILLING.welcome_credits, true),
    low_credit_threshold: num(s.low_credit_threshold, 0, 1_000_000, DEFAULT_BILLING.low_credit_threshold, true),
    action_costs: costs,
    enforce: s.enforce !== false,
  }
}

/** Credits bought with `amount` soles (whole credits, rounded down). */
export function creditsFor(amount: number, settings: BillingSettings): number {
  return Math.floor((amount + 1e-9) / settings.credit_price)
}

export type TopupCheck = { ok: true; amount: number; credits: number } | { ok: false; error: 'invalid_amount' | 'below_minimum' | 'too_large' }

/** Top-ups are whole soles between the minimum and S/ 50,000. */
export function checkTopup(raw: unknown, settings: BillingSettings): TopupCheck {
  const amount = typeof raw === 'string' ? Number(raw) : raw
  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) return { ok: false, error: 'invalid_amount' }
  if (amount < settings.min_topup) return { ok: false, error: 'below_minimum' }
  if (amount > 50_000) return { ok: false, error: 'too_large' }
  return { ok: true, amount, credits: creditsFor(amount, settings) }
}

export function actionCost(action: BillableAction, settings: BillingSettings): number {
  return settings.action_costs[action] ?? 1
}
