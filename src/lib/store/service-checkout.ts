// Checkout form of a store service. Pure, shared by the form and the server.
import { checkoutPhone } from './checkout'

export interface ServiceCheckoutInput {
  service_id: string
  staff_id: string | null
  date: string | null
  time: string | null
  customer: { name: string; phone: string; email: string | null; document: string | null }
  payment_method_id: string | null
  /** Industry booking data (age, party size…), by key. */
  fields: Record<string, string | number>
  notes: string | null
}

export type ServiceCheckoutError = 'service' | 'slot' | 'name' | 'phone' | 'email' | 'document' | 'fields'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '')

/** needsSlot: the service books its appointment at checkout. */
export function parseServiceCheckout(
  body: Record<string, unknown> | null,
  dialCode: string,
  needsSlot: boolean,
): { ok: true; input: ServiceCheckoutInput } | { ok: false; error: ServiceCheckoutError } {
  if (!body) return { ok: false, error: 'service' }
  const service_id = typeof body.service_id === 'string' && UUID.test(body.service_id) ? body.service_id : ''
  if (!service_id) return { ok: false, error: 'service' }
  const staff_id = typeof body.staff_id === 'string' && UUID.test(body.staff_id) ? body.staff_id : null
  const date = typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : null
  const time = typeof body.time === 'string' && /^\d{2}:\d{2}$/.test(body.time) ? body.time : null
  if (needsSlot && (!date || !time)) return { ok: false, error: 'slot' }

  const c = (body.customer ?? {}) as Record<string, unknown>
  const name = text(c.name, 120)
  if (name.length < 2) return { ok: false, error: 'name' }
  const phone = checkoutPhone(typeof c.phone === 'string' ? c.phone : '', dialCode)
  if (!phone) return { ok: false, error: 'phone' }
  const email = text(c.email, 160).toLowerCase()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return { ok: false, error: 'email' }
  const doc = text(c.document, 20).replace(/\s/g, '')
  if (doc && !/^[A-Za-z0-9-]{6,20}$/.test(doc)) return { ok: false, error: 'document' }

  const fields: Record<string, string | number> = {}
  const rawFields = body.fields && typeof body.fields === 'object' && !Array.isArray(body.fields) ? (body.fields as Record<string, unknown>) : {}
  for (const [k, v] of Object.entries(rawFields).slice(0, 10)) {
    if (!/^[a-z_]{1,40}$/.test(k)) continue
    if (typeof v === 'number' && Number.isFinite(v)) fields[k] = v
    else if (typeof v === 'string' && v.trim()) fields[k] = v.trim().slice(0, 200)
  }

  return {
    ok: true,
    input: {
      service_id,
      staff_id,
      date: needsSlot ? date : null,
      time: needsSlot ? time : null,
      customer: { name, phone, email: email || null, document: doc || null },
      payment_method_id: typeof body.payment_method_id === 'string' && UUID.test(body.payment_method_id) ? body.payment_method_id : null,
      fields,
      notes: text(body.notes, 500) || null,
    },
  }
}
