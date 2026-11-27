// The setup wizard shown after signup (pure: no database).

export const WIZARD_STEPS = ['business', 'contact', 'hours', 'catalog', 'faqs', 'agent', 'done'] as const
export type WizardStep = (typeof WIZARD_STEPS)[number]

export type OnboardingStatus = 'pending' | 'done' | 'skipped'

export interface OnboardingState {
  status: OnboardingStatus
  /** Step to resume at (index in WIZARD_STEPS). */
  step: number
}

/** A business without the key is new: the wizard is pending. */
export function onboardingState(settings: unknown): OnboardingState {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>).onboarding : undefined
  if (!raw || typeof raw !== 'object') return { status: 'pending', step: 0 }
  const o = raw as Record<string, unknown>
  const status: OnboardingStatus = o.status === 'done' || o.status === 'skipped' ? o.status : 'pending'
  const n = Number(o.step)
  const step = Number.isInteger(n) && n >= 0 && n < WIZARD_STEPS.length ? n : 0
  return { status, step }
}

/** Opens by itself for the business's owner or admins while pending. */
export function wizardDue(settings: unknown, role: string | null | undefined): boolean {
  return (role === 'owner' || role === 'admin') && onboardingState(settings).status === 'pending'
}

/** The patch the API accepts: { step } while going, { status } to finish or skip. */
export function parseOnboardingPatch(body: unknown): Partial<OnboardingState> | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const out: Partial<OnboardingState> = {}
  if ('step' in b) {
    const n = Number(b.step)
    if (!Number.isInteger(n) || n < 0 || n >= WIZARD_STEPS.length) return null
    out.step = n
  }
  if ('status' in b) {
    if (b.status !== 'done' && b.status !== 'skipped' && b.status !== 'pending') return null
    out.status = b.status
  }
  return Object.keys(out).length ? out : null
}
