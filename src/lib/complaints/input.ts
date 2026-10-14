// Libro de Reclamaciones virtual (Peru). Validation of the hoja de
// reclamación, its number and the response deadline. Pure — safe in tests
// and on the client.

export const COMPLAINT_KINDS = ['reclamo', 'queja'] as const
export const DOC_TYPES = ['dni', 'ce', 'pasaporte', 'ruc'] as const
export const ITEM_TYPES = ['servicio', 'producto'] as const
export type ComplaintKind = (typeof COMPLAINT_KINDS)[number]
export type DocType = (typeof DOC_TYPES)[number]
export type ItemType = (typeof ITEM_TYPES)[number]

/** Business days the provider has to answer (Ley 29571 art. 24, as amended). */
export const RESPONSE_BUSINESS_DAYS = 15

export interface NewComplaint {
  kind: ComplaintKind
  consumer_name: string
  doc_type: DocType
  doc_number: string
  address: string
  phone: string | null
  email: string
  is_minor: boolean
  guardian_name: string | null
  item_type: ItemType
  item_description: string
  amount: number | null
  detail: string
  request: string
}

/** Field → i18n error key under complaints.errors. */
export type ComplaintErrors = Partial<Record<keyof NewComplaint | 'accepted', string>>

const DOC_PATTERNS: Record<DocType, RegExp> = {
  dni: /^\d{8}$/,
  ce: /^[A-Za-z0-9]{8,12}$/,
  pasaporte: /^[A-Za-z0-9]{6,12}$/,
  ruc: /^(10|15|17|20)\d{9}$/,
}

const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '')
const longText = (v: unknown) => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : '')
const oneOf = <T extends string>(list: readonly T[], v: unknown): T | null => (list as readonly string[]).includes(v as string) ? (v as T) : null

export function parseComplaint(raw: Record<string, unknown>): { ok: true; value: NewComplaint } | { ok: false; errors: ComplaintErrors } {
  const errors: ComplaintErrors = {}
  const kind = oneOf(COMPLAINT_KINDS, raw.kind)
  if (!kind) errors.kind = 'required'

  const consumer_name = text(raw.consumer_name)
  if (consumer_name.length < 3 || consumer_name.length > 150) errors.consumer_name = 'name'

  const doc_type = oneOf(DOC_TYPES, raw.doc_type)
  const doc_number = text(raw.doc_number).replace(/[\s.-]/g, '').toUpperCase()
  if (!doc_type) errors.doc_type = 'required'
  else if (!DOC_PATTERNS[doc_type].test(doc_number)) errors.doc_number = `doc_${doc_type}`

  const address = text(raw.address)
  if (address.length < 5 || address.length > 300) errors.address = 'address'

  const phone = text(raw.phone) || null
  if (phone && !/^\+?[\d\s()-]{6,20}$/.test(phone)) errors.phone = 'phone'

  const email = text(raw.email).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) errors.email = 'email'

  const is_minor = raw.is_minor === true
  const guardian_name = is_minor ? text(raw.guardian_name) : null
  if (is_minor && (!guardian_name || guardian_name.length < 3 || guardian_name.length > 150)) errors.guardian_name = 'guardian'

  const item_type = oneOf(ITEM_TYPES, raw.item_type)
  if (!item_type) errors.item_type = 'required'
  const item_description = text(raw.item_description)
  if (item_description.length < 3 || item_description.length > 300) errors.item_description = 'item'

  let amount: number | null = null
  const rawAmount = typeof raw.amount === 'string' ? raw.amount.trim().replace(',', '.') : raw.amount
  if (rawAmount !== '' && rawAmount !== null && rawAmount !== undefined) {
    const n = typeof rawAmount === 'number' ? rawAmount : Number(rawAmount)
    if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) errors.amount = 'amount'
    else amount = Math.round(n * 100) / 100
  }

  const detail = longText(raw.detail)
  if (detail.length < 10 || detail.length > 3000) errors.detail = 'detail'
  const request = longText(raw.request)
  if (request.length < 5 || request.length > 2000) errors.request = 'request'

  if (raw.accepted !== true) errors.accepted = 'accepted'

  if (Object.keys(errors).length) return { ok: false, errors }
  return {
    ok: true,
    value: { kind: kind!, consumer_name, doc_type: doc_type!, doc_number, address, phone, email, is_minor, guardian_name, item_type: item_type!, item_description, amount, detail, request },
  }
}

/** "000042-2026" */
export function complaintCode(number: number, year: number): string {
  return `${String(number).padStart(6, '0')}-${year}`
}

/** Calendar date in Lima (UTC-5, no DST) as y/m/d. */
export function limaDate(at: Date): { y: number; m: number; d: number } {
  const lima = new Date(at.getTime() - 5 * 3600_000)
  return { y: lima.getUTCFullYear(), m: lima.getUTCMonth() + 1, d: lima.getUTCDate() }
}

/** Easter Sunday (Gregorian), month 1-12. */
function easter(y: number): { m: number; d: number } {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  return { m: month, d: ((h + l - 7 * m + 114) % 31) + 1 }
}

const FIXED_HOLIDAYS = ['01-01', '05-01', '06-07', '06-29', '07-23', '07-28', '07-29', '08-06', '08-30', '10-08', '11-01', '12-08', '12-09', '12-25']

/** National public holidays of Peru for a year, as "MM-DD". */
export function peruHolidays(y: number): Set<string> {
  const e = easter(y)
  const sunday = Date.UTC(y, e.m - 1, e.d)
  const mmdd = (t: number) => {
    const x = new Date(t)
    return `${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
  }
  return new Set([...FIXED_HOLIDAYS, mmdd(sunday - 3 * 86400_000), mmdd(sunday - 2 * 86400_000)])
}

/** Date (YYYY-MM-DD, Lima) by which a complaint filed at `at` must be answered. */
export function responseDueDate(at: Date, businessDays = RESPONSE_BUSINESS_DAYS): string {
  const { y, m, d } = limaDate(at)
  let t = Date.UTC(y, m - 1, d)
  let left = businessDays
  const cache = new Map<number, Set<string>>()
  while (left > 0) {
    t += 86400_000
    const x = new Date(t)
    const year = x.getUTCFullYear()
    if (!cache.has(year)) cache.set(year, peruHolidays(year))
    const key = `${String(x.getUTCMonth() + 1).padStart(2, '0')}-${String(x.getUTCDate()).padStart(2, '0')}`
    const dow = x.getUTCDay()
    if (dow !== 0 && dow !== 6 && !cache.get(year)!.has(key)) left -= 1
  }
  return new Date(t).toISOString().slice(0, 10)
}
