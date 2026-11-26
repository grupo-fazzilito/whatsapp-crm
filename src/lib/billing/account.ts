// Payer data for Peru: Culqi asks for it to save the card (and SUNAT for the receipt). Pure.

/** Payment Latam catalogue: id → label and document length rule. */
export const DOC_TYPES = {
  1: { label: 'DNI', re: /^\d{8}$/ },
  2: { label: 'RUC', re: /^\d{11}$/ },
  3: { label: 'CE', re: /^[A-Za-z0-9]{9,12}$/ },
  4: { label: 'PA', re: /^[A-Za-z0-9]{6,12}$/ },
} as const
export type DocType = keyof typeof DOC_TYPES

export interface BillingAccountInput {
  doc_type: DocType
  doc_number: string
  legal_name: string
  email: string
  address: string
  city: string
  phone: string
}

export type AccountCheck =
  | { ok: true; value: BillingAccountInput }
  | { ok: false; error: 'doc_type' | 'doc_number' | 'legal_name' | 'email' | 'address' | 'city' | 'phone' }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function checkBillingAccount(body: Record<string, unknown>): AccountCheck {
  const docType = Number(body.doc_type)
  if (!(docType in DOC_TYPES)) return { ok: false, error: 'doc_type' }
  const doc = String(body.doc_number ?? '').replace(/\s+/g, '')
  if (!DOC_TYPES[docType as DocType].re.test(doc)) return { ok: false, error: 'doc_number' }
  const name = String(body.legal_name ?? '').replace(/\s+/g, ' ').trim()
  if (name.length < 2 || name.length > 200) return { ok: false, error: 'legal_name' }
  const email = String(body.email ?? '').trim().toLowerCase()
  if (email.length > 60 || !EMAIL_RE.test(email)) return { ok: false, error: 'email' }
  const address = String(body.address ?? '').replace(/\s+/g, ' ').trim()
  if (address.length < 5 || address.length > 100) return { ok: false, error: 'address' }
  const city = String(body.city ?? '').replace(/\s+/g, ' ').trim()
  if (city.length < 2 || city.length > 30) return { ok: false, error: 'city' }
  const phone = String(body.phone ?? '').replace(/\D/g, '')
  if (phone.length < 6 || phone.length > 15) return { ok: false, error: 'phone' }
  return { ok: true, value: { doc_type: docType as DocType, doc_number: doc.toUpperCase(), legal_name: name, email, address, city, phone } }
}
