import { describe, expect, it } from 'vitest'
import { onboardingState, parseOnboardingPatch, wizardDue } from './onboarding'

describe('setup wizard state', () => {
  it('is pending for a new business and resumes at the saved step', () => {
    expect(onboardingState({})).toEqual({ status: 'pending', step: 0 })
    expect(onboardingState(null)).toEqual({ status: 'pending', step: 0 })
    expect(onboardingState({ onboarding: { status: 'pending', step: 3 } })).toEqual({ status: 'pending', step: 3 })
    expect(onboardingState({ onboarding: { status: 'done', step: 99 } })).toEqual({ status: 'done', step: 0 })
  })

  it('opens by itself only for owners and admins while pending', () => {
    expect(wizardDue({}, 'owner')).toBe(true)
    expect(wizardDue({}, 'admin')).toBe(true)
    expect(wizardDue({}, 'agent')).toBe(false)
    expect(wizardDue({ onboarding: { status: 'skipped' } }, 'owner')).toBe(false)
    expect(wizardDue({ onboarding: { status: 'done' } }, 'owner')).toBe(false)
  })

  it('accepts only a valid step or status', () => {
    expect(parseOnboardingPatch({ step: 2 })).toEqual({ step: 2 })
    expect(parseOnboardingPatch({ status: 'skipped' })).toEqual({ status: 'skipped' })
    expect(parseOnboardingPatch({ step: 7 })).toBeNull()
    expect(parseOnboardingPatch({ status: 'hacked' })).toBeNull()
    expect(parseOnboardingPatch({})).toBeNull()
    expect(parseOnboardingPatch('x')).toBeNull()
  })
})
