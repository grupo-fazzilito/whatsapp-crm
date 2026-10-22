// Custom contact fields (custom_fields + contact_custom_values). Values are
// stored as text; the type decides how they're edited and shown.

export const FIELD_TYPES = ['text', 'number', 'date', 'select', 'boolean'] as const
export type FieldType = (typeof FIELD_TYPES)[number]

export interface CustomField {
  id: string
  field_name: string
  field_type: FieldType | string
  field_options?: unknown
}

export const isFieldType = (v: unknown): v is FieldType => typeof v === 'string' && (FIELD_TYPES as readonly string[]).includes(v)

/** Options of a 'select' field (field_options: string[]). */
export function optionsOf(field: Pick<CustomField, 'field_options'>): string[] {
  return Array.isArray(field.field_options) ? field.field_options.filter((o): o is string => typeof o === 'string' && !!o.trim()) : []
}

export function parseFieldInput(body: unknown):
  | { ok: true; field: { field_name: string; field_type: FieldType; field_options: string[] | null } }
  | { ok: false; error: 'name' | 'type' | 'options' } {
  const b = (body ?? {}) as Record<string, unknown>
  const name = typeof b.field_name === 'string' ? b.field_name.trim().slice(0, 60) : ''
  if (!name) return { ok: false, error: 'name' }
  const type = b.field_type ?? 'text'
  if (!isFieldType(type)) return { ok: false, error: 'type' }
  let options: string[] | null = null
  if (type === 'select') {
    options = Array.isArray(b.field_options)
      ? [...new Set(b.field_options.map((o) => (typeof o === 'string' ? o.trim().slice(0, 60) : '')).filter(Boolean))].slice(0, 50)
      : []
    if (!options.length) return { ok: false, error: 'options' }
  }
  return { ok: true, field: { field_name: name, field_type: type, field_options: options } }
}

/** A value as the field type expects it, or null when it doesn't fit (it's then not saved). */
export function normalizeValue(field: Pick<CustomField, 'field_type' | 'field_options'>, raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  switch (field.field_type) {
    case 'number':
      return Number.isFinite(Number(v.replace(',', '.'))) ? String(Number(v.replace(',', '.'))) : null
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : null
    case 'boolean':
      return v === 'true' || v === 'false' ? v : null
    case 'select':
      return optionsOf(field).includes(v) ? v : null
    default:
      return v.slice(0, 5000)
  }
}
