/** Row of `ai_agents` (migrations 022 + 024). */
export interface AiAgentRow {
  id: string
  workspace_id: string
  name: string
  /** What this agent handles; routers and transfers choose by it. */
  description: string | null
  persona: string | null
  tone: string
  instructions: string | null
  /** Business knowledge written by the owner (≤ 5,000 chars). */
  training_context?: string | null
  language: 'auto' | 'es' | 'en'
  /** faq | bookings | catalog | orders | handover | router */
  skills: string[]
  greeting_message: string | null
  after_hours_message: string | null
  escalation_keywords: string[]
  business_hours_only: boolean
  model: string | null
  enabled: boolean
  /** Agents this one may hand the conversation to (empty = none, or any for routers). */
  transfer_agent_ids: string[]
}

export type AgentSkill = 'faq' | 'bookings' | 'catalog' | 'orders' | 'handover' | 'router'

/** Option of a channel's welcome menu (channels.settings.welcome_menu). */
export interface WelcomeMenuOption {
  id: string
  label: string
  description?: string
  target: { type: 'agent'; agent_id: string } | { type: 'human'; assignee_user_id?: string | null }
}

export interface WelcomeMenu {
  enabled: boolean
  question: string
  button_label?: string
  options: WelcomeMenuOption[]
}

/** conversations.ai_state */
export interface ConversationAiState {
  /** Booking being assembled across turns. */
  booking?: BookingDraft
  /** Welcome menu was sent and we are waiting for a choice. */
  menu_pending?: boolean
  menu_attempts?: number
  [key: string]: unknown
}

export interface BookingDraft {
  service_id?: string | null
  staff_id?: string | null
  product_id?: string | null
  date?: string | null
  time?: string | null
  customer_name?: string | null
  party_size?: number | null
  fields?: Record<string, string | number | null>
}
