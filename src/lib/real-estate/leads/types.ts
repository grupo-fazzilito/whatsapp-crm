// Client-safe types for real-estate leads (migration 037).

export const LEAD_OPERATIONS = ['buy', 'rent'] as const
export type LeadOperation = (typeof LEAD_OPERATIONS)[number]

export const FINANCING = ['cash', 'mortgage', 'unknown'] as const
export type Financing = (typeof FINANCING)[number]

export const PURPOSES = ['live', 'invest', 'unknown'] as const
export type Purpose = (typeof PURPOSES)[number]

export const TEMPERATURES = ['hot', 'warm', 'cold'] as const
export type Temperature = (typeof TEMPERATURES)[number]

/** Same values as the real_estate preset's property_type attribute. */
export const PROPERTY_TYPES = ['house', 'apartment', 'land', 'office', 'commercial'] as const

export interface LeadProfile {
  id: string
  workspace_id: string
  contact_id: string
  conversation_id: string | null
  operation: LeadOperation | null
  property_types: string[]
  zones: string[]
  budget_min: number | null
  budget_max: number | null
  currency: string | null
  bedrooms_min: number | null
  bathrooms_min: number | null
  parking_min: number | null
  financing: Financing
  mortgage_preapproved: boolean
  move_in: string | null
  purpose: Purpose
  notes: string | null
  score: number
  temperature: Temperature
  qualified_at: string | null
  alerts_opt_in: boolean
  last_matched_at: string | null
  updated_by: 'ai' | 'user'
  created_at: string
  updated_at: string
}

/** The fields the AI / the team can set. */
export type LeadFields = Pick<
  LeadProfile,
  | 'operation'
  | 'property_types'
  | 'zones'
  | 'budget_min'
  | 'budget_max'
  | 'currency'
  | 'bedrooms_min'
  | 'bathrooms_min'
  | 'parking_min'
  | 'financing'
  | 'mortgage_preapproved'
  | 'move_in'
  | 'purpose'
  | 'notes'
  | 'alerts_opt_in'
>

export const EMPTY_LEAD: LeadFields = {
  operation: null,
  property_types: [],
  zones: [],
  budget_min: null,
  budget_max: null,
  currency: null,
  bedrooms_min: null,
  bathrooms_min: null,
  parking_min: null,
  financing: 'unknown',
  mortgage_preapproved: false,
  move_in: null,
  purpose: 'unknown',
  notes: null,
  alerts_opt_in: false,
}

export interface RoutingConditions {
  zones?: string[]
  operation?: LeadOperation | null
  property_types?: string[]
  budget_min?: number | null
  budget_max?: number | null
}

export interface RoutingRule {
  id: string
  workspace_id: string
  name: string
  priority: number
  conditions: RoutingConditions
  team_id: string | null
  user_id: string | null
  active: boolean
  created_at?: string
  updated_at?: string
}

/** A listing as the matcher sees it. */
export interface MatchProperty {
  id: string
  name: string
  price: number | null
  /** products.currency (ISO; null = workspace currency). */
  currency?: string | null
  images: string[]
  attributes: Record<string, unknown>
  is_active: boolean
  /** Column value when the listings module stores it outside attributes. */
  listing_status?: string | null
}

export interface PropertyMatch {
  product: MatchProperty
  /** Higher is better (ranking only). */
  rank: number
}

/** Post-visit answers (bookings.viewing_feedback). */
export const VISIT_FEEDBACK = ['interested', 'others', 'not_convinced'] as const
export type VisitFeedback = (typeof VISIT_FEEDBACK)[number]
