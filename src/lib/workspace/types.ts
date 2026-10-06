import type { WorkspaceRole } from './constants'

export interface WorkspaceSettings {
  /** Label overrides on top of the industry preset, per locale. */
  labels?: Record<string, Record<string, string>>
  /** Module switches on top of the industry preset. */
  modules?: Record<string, boolean>
  /** Concurrent bookings per time slot when bookings don't need staff. */
  booking_capacity?: number
  [key: string]: unknown
}

export interface Workspace {
  id: string
  name: string
  slug: string
  industry: string
  country: string | null
  currency: string
  timezone: string
  locale: 'es' | 'en'
  description: string | null
  phone: string | null
  email: string | null
  website: string | null
  address: string | null
  city: string | null
  state: string | null
  postal_code: string | null
  google_map_link: string | null
  logo_url: string | null
  /** Free-text specialty, e.g. "Dental care", "Barbería clásica". */
  business_type_detail: string | null
  /** Holidays / special hours: {date, is_closed, opening_time?, closing_time?, reason?}[] */
  date_exceptions: { date: string; is_closed: boolean; opening_time?: string | null; closing_time?: string | null; reason?: string | null }[]
  settings: WorkspaceSettings
  created_at: string
  updated_at: string
}

export interface WorkspaceMember {
  id: string
  workspace_id: string
  user_id: string
  role: WorkspaceRole
  status: 'active' | 'disabled'
  created_at: string
  profile?: { full_name: string | null; email: string; avatar_url: string | null } | null
}

export interface WorkspaceInvitation {
  id: string
  workspace_id: string
  email: string
  role: Exclude<WorkspaceRole, 'owner'>
  expires_at: string
  accepted_at: string | null
  created_at: string
}
