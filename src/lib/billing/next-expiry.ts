// The next credits to expire, as the screens show them (pure: no database).

export interface NextExpiryView {
  at: string
  credits: number
  /** The plan's credits: they are replaced at the renewal, so the date shown is the renewal date. */
  renews: boolean
}

const ACTIVE = new Set(['active', 'trialing', 'past_due'])

/**
 * The plan's credits are granted until a few days after the period end (grace
 * while a failed renewal is retried) but are replaced when the plan renews:
 * for them the renewal date is what matters to the business.
 */
export function nextExpiryView(
  lot: { expires_at: Date | string; credits_remaining: number; source?: string | null } | null | undefined,
  sub: { status: string; current_period_end: Date | string | null; cancel_at_period_end?: boolean } | null | undefined,
): NextExpiryView | null {
  if (!lot) return null
  const at = new Date(lot.expires_at)
  if (lot.source === 'subscription' && sub && ACTIVE.has(sub.status) && sub.current_period_end) {
    const end = new Date(sub.current_period_end)
    if (end.getTime() < at.getTime()) return { at: end.toISOString(), credits: lot.credits_remaining, renews: !sub.cancel_at_period_end }
  }
  return { at: at.toISOString(), credits: lot.credits_remaining, renews: false }
}
