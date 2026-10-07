import { getPreset, type AttributeField } from '@/lib/industries'
import type { WorkspaceSettings } from '@/lib/workspace/types'

// Effective product attributes for a workspace: the industry preset's
// fields plus the workspace's own extra fields
// (workspaces.settings.product_attributes). A workspace field with the
// same key as a preset field replaces it.
export function productAttributesFor(industry: string, settings?: WorkspaceSettings | null): AttributeField[] {
  const own = Array.isArray(settings?.product_attributes) ? (settings!.product_attributes as AttributeField[]) : []
  const byKey = new Map<string, AttributeField>()
  for (const f of getPreset(industry).productAttributes) byKey.set(f.key, f)
  for (const f of own) if (f?.key && /^[a-z0-9_]+$/.test(f.key)) byKey.set(f.key, f)
  return [...byKey.values()]
}

export type AttributeValue = string | number | boolean | string[]

export interface AttributeValidation {
  values: Record<string, AttributeValue>
  errors: Record<string, string>
}

/**
 * Coerces raw form/import values to each field's type and checks
 * required fields and select options. Unknown keys are dropped.
 */
export function validateAttributes(fields: AttributeField[], raw: Record<string, unknown>): AttributeValidation {
  const values: Record<string, AttributeValue> = {}
  const errors: Record<string, string> = {}
  for (const f of fields) {
    const v = raw?.[f.key]
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)
    if (empty) {
      if (f.required) errors[f.key] = 'required'
      continue
    }
    const options = f.options?.map((o) => o.value)
    switch (f.type) {
      case 'number': {
        const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
        if (!Number.isFinite(n)) errors[f.key] = 'number'
        else values[f.key] = n
        break
      }
      case 'boolean':
        values[f.key] = v === true || ['true', '1', 'si', 'sí', 'yes', 'x'].includes(String(v).trim().toLowerCase())
        break
      case 'select': {
        const s = String(v).trim()
        const match = options?.find((o) => o.toLowerCase() === s.toLowerCase())
          ?? f.options?.find((o) => Object.values(o.label).some((l) => l.toLowerCase() === s.toLowerCase()))?.value
        if (options && !match) errors[f.key] = 'option'
        else values[f.key] = match ?? s
        break
      }
      case 'multiselect': {
        const list = (Array.isArray(v) ? v : String(v).split(/[,;|]/)).map((x) => String(x).trim()).filter(Boolean)
        const mapped = list.map(
          (s) =>
            options?.find((o) => o.toLowerCase() === s.toLowerCase()) ??
            f.options?.find((o) => Object.values(o.label).some((l) => l.toLowerCase() === s.toLowerCase()))?.value ??
            (options ? null : s),
        )
        if (mapped.some((m) => m === null)) errors[f.key] = 'option'
        else values[f.key] = mapped as string[]
        break
      }
      default:
        values[f.key] = String(v).trim().slice(0, f.type === 'textarea' ? 4000 : 300)
    }
  }
  return { values, errors }
}
