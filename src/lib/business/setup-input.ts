// Input parsing for the business-setup and bookings API routes (the
// browser used to write these tables directly). Pure: each parser keeps
// only known columns with the expected types and throws InputError on
// invalid values. `partial` parsers only include keys present in the body.
import { INDUSTRY_IDS } from '@/lib/industries'
import { parseReminderSettings } from '@/lib/bookings/reminder-settings'

export class InputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InputError'
  }
}

type Body = Record<string, unknown>
type Row = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const
export const PAYMENT_METHOD_TYPES = ['qr', 'bank_transfer', 'cash', 'card_on_delivery', 'other'] as const

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID.test(v)
}

export function isPlainObject(v: unknown): v is Body {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

/** Trimmed text (max length) or null for empty / non-string. */
function text(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') throw new InputError('Invalid text value')
  const s = v.trim()
  return s ? s.slice(0, max) : null
}

function requiredText(v: unknown, max: number, field: string): string {
  const s = text(v, max)
  if (!s) throw new InputError(`${field} is required`)
  return s
}

function bool(v: unknown, field: string): boolean {
  if (typeof v !== 'boolean') throw new InputError(`${field} must be a boolean`)
  return v
}

function nonNegative(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function int(v: unknown, min: number, max: number, field: string): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new InputError(`${field} must be an integer between ${min} and ${max}`)
  return n
}

function time(v: unknown, field: string): string {
  if (typeof v !== 'string' || !TIME.test(v)) throw new InputError(`${field} must be HH:MM`)
  return v.slice(0, 5)
}

function optTime(v: unknown, field: string): string | null {
  return v === null || v === undefined || v === '' ? null : time(v, field)
}

function optUuid(v: unknown, field: string): string | null {
  if (v === null || v === undefined || v === '') return null
  if (!isUuid(v)) throw new InputError(`${field} must be a uuid`)
  return v
}

function uuidList(v: unknown, field: string): string[] {
  if (!Array.isArray(v) || !v.every(isUuid)) throw new InputError(`${field} must be a list of ids`)
  return [...new Set(v)]
}

/** Copies the keys present in `body` through their parser. */
function pick(body: Body, parsers: Record<string, (v: unknown) => unknown>): Row {
  const out: Row = {}
  for (const [k, parse] of Object.entries(parsers)) if (k in body) out[k] = parse(body[k])
  return out
}

function requireKeys(row: Row, keys: string[]) {
  for (const k of keys) if (!(k in row)) throw new InputError(`${k} is required`)
}

// ------------------------------------------------------------ services
const SERVICE_FIELDS: Record<string, (v: unknown) => unknown> = {
  name: (v) => requiredText(v, 200, 'name'),
  description: (v) => text(v, 5000),
  category: (v) => text(v, 120),
  price: nonNegative,
  price_is_from: (v) => bool(v, 'price_is_from'),
  duration_minutes: (v) => int(v, 5, 1440, 'duration_minutes'),
  is_active: (v) => bool(v, 'is_active'),
}

export function parseService(body: Body, partial: boolean): Row {
  const row = pick(body, SERVICE_FIELDS)
  if (!partial) requireKeys(row, ['name'])
  return row
}

// ------------------------------------------------------------ faqs
const FAQ_FIELDS: Record<string, (v: unknown) => unknown> = {
  question: (v) => requiredText(v, 1000, 'question'),
  answer: (v) => requiredText(v, 10000, 'answer'),
  keywords: (v) => text(v, 1000),
  ai_agent_ids: (v) => (v === null ? [] : uuidList(v, 'ai_agent_ids')),
}

export function parseFaq(body: Body, partial: boolean): Row {
  const row = pick(body, FAQ_FIELDS)
  if (!partial) requireKeys(row, ['question', 'answer'])
  return row
}

// ------------------------------------------------------------ staff
// JSON blobs keep their stored shape (older rows may differ slightly):
// only the known keys are kept and each must be a primitive.
function jsonEntry(v: unknown, keys: string[]): Row {
  if (!isPlainObject(v)) throw new InputError('Invalid entry')
  const out: Row = {}
  for (const k of keys) {
    if (!(k in v)) continue
    const x = v[k]
    if (x !== null && !['string', 'number', 'boolean'].includes(typeof x)) throw new InputError(`Invalid ${k}`)
    out[k] = x
  }
  return out
}

const SLOT_KEYS = ['start_time', 'end_time', 'is_active']

function slot(v: unknown): Row {
  const s = jsonEntry(v, SLOT_KEYS)
  if (typeof s.start_time !== 'string' || !TIME.test(s.start_time)) throw new InputError('start_time must be HH:MM')
  return s
}

function weeklySlots(v: unknown) {
  if (v === null || v === undefined) return {}
  if (!isPlainObject(v)) throw new InputError('weekly_slots must be an object')
  const out: Record<string, Row[]> = {}
  for (const [day, list] of Object.entries(v)) {
    if (!(DAY_NAMES as readonly string[]).includes(day)) continue
    if (!Array.isArray(list)) throw new InputError('weekly_slots values must be lists')
    if (list.length) out[day] = list.map(slot)
  }
  return out
}

function datedList(v: unknown, keys: string[], withSlots: boolean): Row[] {
  if (v === null || v === undefined) return []
  if (!Array.isArray(v)) throw new InputError('date_exceptions must be a list')
  return v.map((e) => {
    const out = jsonEntry(e, keys)
    if (typeof out.date !== 'string' || !DATE.test(out.date)) throw new InputError('Invalid date exception')
    if (withSlots && isPlainObject(e) && Array.isArray(e.slots)) out.slots = e.slots.map(slot)
    return out
  })
}

const staffExceptions = (v: unknown) => datedList(v, ['date', 'is_available', 'reason'], true)

const STAFF_FIELDS: Record<string, (v: unknown) => unknown> = {
  name: (v) => requiredText(v, 200, 'name'),
  title: (v) => text(v, 200),
  qualification: (v) => text(v, 500),
  experience: (v) => text(v, 500),
  fee: nonNegative,
  languages: (v) => text(v, 300),
  photo_url: (v) => text(v, 2000),
  bio: (v) => text(v, 5000),
  email: (v) => text(v, 320),
  phone: (v) => text(v, 50),
  is_active: (v) => bool(v, 'is_active'),
  member_user_id: (v) => optUuid(v, 'member_user_id'),
  available_days: (v) => {
    if (!Array.isArray(v)) throw new InputError('available_days must be a list')
    return DAY_NAMES.filter((d) => v.includes(d))
  },
  available_start_time: (v) => optTime(v, 'available_start_time'),
  available_end_time: (v) => optTime(v, 'available_end_time'),
  weekly_slots: weeklySlots,
  date_exceptions: staffExceptions,
}

export function parseStaff(body: Body, partial: boolean): Row {
  const row = pick(body, STAFF_FIELDS)
  if (!partial) requireKeys(row, ['name'])
  return row
}

// ------------------------------------------------------------ business hours
export interface HoursRow {
  day_name: string
  opening_time: string
  closing_time: string
  is_closed: boolean
  break_start: string | null
  break_end: string | null
}

export function parseHours(v: unknown): HoursRow[] {
  if (!Array.isArray(v) || !v.length) throw new InputError('hours must be a list')
  const seen = new Set<string>()
  return v.map((r) => {
    if (!isPlainObject(r) || !(DAY_NAMES as readonly string[]).includes(r.day_name as string)) throw new InputError('Invalid day')
    const day = r.day_name as string
    if (seen.has(day)) throw new InputError(`Duplicated day ${day}`)
    seen.add(day)
    return {
      day_name: day,
      opening_time: time(r.opening_time, 'opening_time'),
      closing_time: time(r.closing_time, 'closing_time'),
      is_closed: bool(r.is_closed, 'is_closed'),
      break_start: optTime(r.break_start, 'break_start'),
      break_end: optTime(r.break_end, 'break_end'),
    }
  })
}

// ------------------------------------------------------------ workspace profile / settings
const LOCALES = ['es', 'en']

const dateExceptions = (v: unknown) => {
  if (!Array.isArray(v)) throw new InputError('date_exceptions must be a list')
  return datedList(v, ['date', 'is_closed', 'opening_time', 'closing_time', 'reason'], false)
}

const WORKSPACE_FIELDS: Record<string, (v: unknown) => unknown> = {
  name: (v) => requiredText(v, 200, 'name'),
  business_type_detail: (v) => text(v, 200),
  description: (v) => text(v, 5000),
  phone: (v) => text(v, 50),
  email: (v) => text(v, 320),
  website: (v) => text(v, 500),
  address: (v) => text(v, 500),
  city: (v) => text(v, 120),
  state: (v) => text(v, 120),
  postal_code: (v) => text(v, 30),
  google_map_link: (v) => text(v, 2000),
  country: (v) => text(v, 10),
  currency: (v) => requiredText(v, 10, 'currency'),
  timezone: (v) => {
    const tz = text(v, 100) ?? 'UTC'
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
    } catch {
      throw new InputError('Invalid timezone')
    }
    return tz
  },
  locale: (v) => {
    if (typeof v !== 'string' || !LOCALES.includes(v)) throw new InputError('Invalid locale')
    return v
  },
  industry: (v) => {
    if (typeof v !== 'string' || !INDUSTRY_IDS.includes(v)) throw new InputError('Invalid industry')
    return v
  },
  date_exceptions: dateExceptions,
}

/** Column updates of the workspace row (profile, industry, special dates). */
export function parseWorkspacePatch(body: Body): Row {
  return pick(body, WORKSPACE_FIELDS)
}

/** Top-level settings keys the setup screens may write. */
export const SETTINGS_KEYS = ['modules', 'labels', 'booking_capacity', 'orders', 'product_attributes', 'booking_reminders'] as const

/** Merges a settings patch (top-level keys) into the latest stored settings. */
export function mergeSettings(current: unknown, patch: unknown): Row {
  if (!isPlainObject(patch)) throw new InputError('settings must be an object')
  const base: Row = isPlainObject(current) ? { ...current } : {}
  for (const [k, v] of Object.entries(patch)) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(k)) throw new InputError(`settings.${k} cannot be changed here`)
    if (k === 'booking_capacity') base[k] = int(v, 1, 500, 'booking_capacity')
    else if (k === 'booking_reminders') {
      try {
        base[k] = parseReminderSettings(v)
      } catch (err) {
        throw new InputError(err instanceof Error ? err.message : 'Invalid booking_reminders')
      }
    } else if (k === 'product_attributes') {
      if (!Array.isArray(v)) throw new InputError('product_attributes must be a list')
      base[k] = v
    } else if (k === 'orders') {
      // Keeps unknown order keys the screen does not edit.
      if (!isPlainObject(v)) throw new InputError('orders must be an object')
      base[k] = { ...(isPlainObject(base[k]) ? (base[k] as Row) : {}), ...v }
    } else {
      if (!isPlainObject(v)) throw new InputError(`${k} must be an object`)
      base[k] = v
    }
  }
  return base
}

// ------------------------------------------------------------ payment methods
const PAYMENT_FIELDS: Record<string, (v: unknown) => unknown> = {
  name: (v) => requiredText(v, 60, 'name'),
  type: (v) => {
    if (typeof v !== 'string' || !(PAYMENT_METHOD_TYPES as readonly string[]).includes(v)) throw new InputError('Invalid type')
    return v
  },
  instructions: (v) => text(v, 1000),
  qr_image_url: (v) => text(v, 2000),
  requires_proof: (v) => bool(v, 'requires_proof'),
  is_active: (v) => bool(v, 'is_active'),
}

export function parsePaymentMethod(body: Body, partial: boolean): Row {
  const row = pick(body, PAYMENT_FIELDS)
  if (!partial) requireKeys(row, ['name'])
  return row
}

// ------------------------------------------------------------ bookings
const BOOKING_FIELDS: Record<string, (v: unknown) => unknown> = {
  contact_id: (v) => {
    if (!isUuid(v)) throw new InputError('contact_id is required')
    return v
  },
  customer_name: (v) => text(v, 200),
  service_id: (v) => optUuid(v, 'service_id'),
  staff_id: (v) => optUuid(v, 'staff_id'),
  product_id: (v) => optUuid(v, 'product_id'),
  booking_date: (v) => {
    if (typeof v !== 'string' || !DATE.test(v) || Number.isNaN(Date.parse(v))) throw new InputError('booking_date must be YYYY-MM-DD')
    return v
  },
  booking_time: (v) => time(v, 'booking_time'),
  duration_minutes: (v) => int(v, 5, 1440, 'duration_minutes'),
  party_size: (v) => (v === null || v === undefined || v === '' ? null : int(v, 1, 100000, 'party_size')),
  custom_fields: (v) => {
    if (v === null || v === undefined) return {}
    if (!isPlainObject(v)) throw new InputError('custom_fields must be an object')
    return v
  },
  notes: (v) => text(v, 5000),
  status: (v) => {
    if (typeof v !== 'string' || !(BOOKING_STATUSES as readonly string[]).includes(v)) throw new InputError('Invalid status')
    return v
  },
}

export function parseBooking(body: Body, partial: boolean): Row {
  const row = pick(body, BOOKING_FIELDS)
  if (!partial) requireKeys(row, ['contact_id', 'booking_date', 'booking_time'])
  return row
}
