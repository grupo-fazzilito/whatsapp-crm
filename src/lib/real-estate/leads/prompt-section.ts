// Real-estate additions to the AI agent prompt and output schema:
// lead qualification (output `lead_profile`) and owner captures (output
// `capture`). Pure: the engine merges the outputs server-side.

import type { LeadFields } from './types'

/** Real-estate workspaces whose agent sells or books viewings. */
export function qualifiesLeads(industry: string | null | undefined, skills: string[]): boolean {
  return industry === 'real_estate' && (skills.includes('catalog') || skills.includes('bookings'))
}

/** Gemini-safe schema (object with optional fields; arrays of strings). */
export const LEAD_PROFILE_SCHEMA = {
  type: 'OBJECT',
  description: 'What the customer is looking for; only fields the customer stated',
  properties: {
    operation: { type: 'STRING', enum: ['buy', 'rent'] },
    property_types: { type: 'ARRAY', items: { type: 'STRING' }, description: 'house | apartment | land | office | commercial' },
    zones: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Districts / neighborhoods' },
    budget_min: { type: 'NUMBER' },
    budget_max: { type: 'NUMBER' },
    currency: { type: 'STRING', description: 'ISO code, e.g. PEN or USD' },
    bedrooms_min: { type: 'NUMBER' },
    bathrooms_min: { type: 'NUMBER' },
    parking_min: { type: 'NUMBER' },
    financing: { type: 'STRING', enum: ['cash', 'mortgage', 'unknown'] },
    mortgage_preapproved: { type: 'BOOLEAN' },
    move_in: { type: 'STRING', description: 'When they want to move/buy, in the customer words or YYYY-MM' },
    purpose: { type: 'STRING', enum: ['live', 'invest', 'unknown'] },
    notes: { type: 'STRING', description: 'Other relevant requirements (pets, floor, amenities...)' },
    alerts_opt_in: { type: 'BOOLEAN', description: 'true only if the customer accepts to receive new matching listings' },
  },
} as const

export const CAPTURE_SCHEMA = {
  type: 'OBJECT',
  description: 'Owner who wants the agency to sell or rent THEIR property',
  properties: {
    operation: { type: 'STRING', enum: ['sale', 'rent'] },
    property_type: { type: 'STRING' },
    district: { type: 'STRING' },
    address: { type: 'STRING' },
    area_m2: { type: 'NUMBER' },
    bedrooms: { type: 'NUMBER' },
    bathrooms: { type: 'NUMBER' },
    parking: { type: 'NUMBER' },
    expected_price: { type: 'NUMBER' },
    currency: { type: 'STRING' },
    owner_name: { type: 'STRING' },
    owner_phone: { type: 'STRING' },
    description: { type: 'STRING' },
    complete: { type: 'BOOLEAN', description: 'true when operation, property_type, district and owner_name are known' },
  },
} as const

export interface CaptureOutput {
  operation?: 'sale' | 'rent'
  property_type?: string
  district?: string
  address?: string
  area_m2?: number
  bedrooms?: number
  bathrooms?: number
  parking?: number
  expected_price?: number
  currency?: string
  owner_name?: string
  owner_phone?: string
  description?: string
  complete?: boolean
}

function known(profile: Partial<LeadFields> | null | undefined): string {
  if (!profile) return 'nothing yet'
  const parts = [
    profile.operation ? `operation=${profile.operation}` : '',
    profile.zones?.length ? `zones=${profile.zones.join('/')}` : '',
    profile.property_types?.length ? `types=${profile.property_types.join('/')}` : '',
    profile.budget_min ? `budget_min=${profile.budget_min}` : '',
    profile.budget_max ? `budget_max=${profile.budget_max}` : '',
    profile.currency ? `currency=${profile.currency}` : '',
    profile.bedrooms_min != null ? `bedrooms_min=${profile.bedrooms_min}` : '',
    profile.financing && profile.financing !== 'unknown' ? `financing=${profile.financing}${profile.mortgage_preapproved ? ' (pre-approved)' : ''}` : '',
    profile.move_in ? `move_in=${profile.move_in}` : '',
    profile.purpose && profile.purpose !== 'unknown' ? `purpose=${profile.purpose}` : '',
    profile.alerts_opt_in ? 'alerts_opt_in=true' : '',
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : 'nothing yet'
}

/** LEAD QUALIFICATION + OWNER LISTINGS prompt sections. */
export function realEstateLeadSections(profile: Partial<LeadFields> | null | undefined, currency: string): string[] {
  const missing: string[] = []
  if (!profile?.operation) missing.push('buy or rent')
  if (!profile?.zones?.length) missing.push('zone(s)')
  if (!profile?.budget_max && !profile?.budget_min) missing.push('budget')
  if (profile?.bedrooms_min == null) missing.push('bedrooms')
  if (!profile?.financing || profile.financing === 'unknown') missing.push('financing (cash / mortgage, pre-approved?)')
  if (!profile?.move_in) missing.push('when they plan to move')
  return [
    [
      'LEAD QUALIFICATION (buyers / tenants):',
      '- While helping, learn naturally what the customer needs: buy or rent, zone(s), budget, bedrooms, financing (cash or mortgage, pre-approved?), and when they plan to move. Ask at most ONE or TWO of these per message, woven into the conversation — never a questionnaire, and never ask again for something already known.',
      `- Already known: ${known(profile)}.`,
      missing.length ? `- Still unknown: ${missing.join(', ')}.` : '- The profile is complete: focus on showing listings and booking a viewing.',
      `- On EVERY turn, put in lead_profile only what the customer stated, with EXACTLY these keys: operation ("buy"|"rent"), property_types (array: house|apartment|land|office|commercial), zones (array of district names), budget_min / budget_max (numbers without symbols; "hasta 3000" → budget_max 3000), currency (ISO code, default ${currency}), bedrooms_min, bathrooms_min, parking_min, financing ("cash"|"mortgage"), mortgage_preapproved, move_in (their words), purpose ("live"|"invest"), notes, alerts_opt_in.`,
      '- When you show listings, offer once to notify them of new matching listings; set lead_profile.alerts_opt_in=true only if they accept.',
    ].join('\n'),
    [
      'OWNER LISTINGS (customers who want to SELL or RENT OUT their own property):',
      '- Do not treat them as buyers. Collect step by step: sale or rent, property type, district and address, area m², bedrooms, bathrooms, expected price, and their name (and phone if not on WhatsApp).',
      '- Put what you know in capture on every turn; set capture.complete=true once operation, property type, district and name are known. Then tell them an advisor will contact them to evaluate the property.',
    ].join('\n'),
  ]
}
