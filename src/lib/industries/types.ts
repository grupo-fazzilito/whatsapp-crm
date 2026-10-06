export type Locale = 'es' | 'en'
export type Localized = Record<Locale, string>

export type ModuleKey = 'staff' | 'services' | 'bookings' | 'products' | 'orders' | 'triage'

/** Nouns the UI and the AI use for this industry (singular + plural). */
export interface IndustryLabels {
  staff: Localized
  staffPlural: Localized
  service: Localized
  servicePlural: Localized
  booking: Localized
  bookingPlural: Localized
  product: Localized
  productPlural: Localized
  customer: Localized
  customerPlural: Localized
}

export type AttributeType = 'text' | 'textarea' | 'number' | 'select' | 'multiselect' | 'boolean'

/** One custom field on a product (stored in products.attributes JSONB). */
export interface AttributeField {
  key: string
  type: AttributeType
  label: Localized
  options?: { value: string; label: Localized }[]
  unit?: string
  required?: boolean
  /** Customers / the AI can filter the catalog by it. */
  filterable?: boolean
}

/** Extra data the AI collects before confirming a booking. */
export interface BookingField {
  key: string
  type: 'text' | 'number' | 'product'
  label: Localized
  required: boolean
}

export interface IndustryPreset {
  id: string
  name: Localized
  description: Localized
  /** lucide-react icon name */
  icon: string
  labels: IndustryLabels
  modules: Record<ModuleKey, boolean>
  /** Booking requires choosing a staff member (e.g. clinic, barbershop). */
  bookingNeedsStaff: boolean
  productAttributes: AttributeField[]
  bookingFields: BookingField[]
  /** How orders are fulfilled, when the orders module is on. */
  fulfillment: ('pickup' | 'delivery' | 'dine_in')[]
  ai: {
    /** One-line persona appended to the system prompt. */
    persona: Localized
    /** Industry-specific rules (safety, tone, what never to promise). */
    rules: Localized[]
  }
  seedFaqs: { question: Localized; answer: Localized }[]
}
