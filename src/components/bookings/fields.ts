import type { BookingField } from '@/lib/industries'
import { isColumnField, type Booking } from './types'

/** Preset fields stored in custom_fields (age, reason, level...). */
export function customFieldDefs(fields: BookingField[]) {
  return fields.filter((f) => !isColumnField(f) && f.type !== 'product')
}

/** "Edad: 34 · Motivo: dolor de muela" for list rows. */
export function customFieldSummary(b: Booking, fields: BookingField[], locale: 'es' | 'en'): string {
  const values = b.custom_fields ?? {}
  const known = customFieldDefs(fields)
  const parts = known
    .filter((f) => values[f.key] !== undefined && values[f.key] !== null && values[f.key] !== '')
    .map((f) => `${f.label[locale]}: ${String(values[f.key])}`)
  // Answers the AI collected under keys the preset doesn't list.
  for (const [k, v] of Object.entries(values)) {
    if (known.some((f) => f.key === k) || v === null || v === '' || typeof v === 'object') continue
    parts.push(`${k}: ${String(v)}`)
  }
  return parts.join(' · ')
}
