import { badRequest } from './errors'

// Small typed readers for JSON bodies / query params. Each throws a 400
// ApiError naming the field.

type Body = Record<string, unknown>

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuidLike(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v)
}

/** Present-and-not-undefined: PATCH semantics ("key sent" vs "omitted"). */
export function has(body: Body, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined
}

export function str(body: Body, key: string, opts: { required?: boolean; max?: number; nullable?: boolean } = {}): string | null | undefined {
  const v = body[key]
  if (v === undefined) {
    if (opts.required) throw badRequest(`${key} is required.`, { field: key })
    return undefined
  }
  if (v === null || (typeof v === 'string' && !v.trim())) {
    if (opts.required) throw badRequest(`${key} is required.`, { field: key })
    if (opts.nullable === false) throw badRequest(`${key} can't be empty.`, { field: key })
    return null
  }
  if (typeof v !== 'string') throw badRequest(`${key} must be a string.`, { field: key })
  const s = v.replace(/\u0000/g, '').trim()
  if (opts.max && s.length > opts.max) throw badRequest(`${key} is too long (max ${opts.max}).`, { field: key })
  return s
}

export function num(body: Body, key: string, opts: { required?: boolean; min?: number; max?: number; integer?: boolean } = {}): number | null | undefined {
  const v = body[key]
  if (v === undefined) {
    if (opts.required) throw badRequest(`${key} is required.`, { field: key })
    return undefined
  }
  if (v === null || v === '') {
    if (opts.required) throw badRequest(`${key} is required.`, { field: key })
    return null
  }
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  if (!Number.isFinite(n)) throw badRequest(`${key} must be a number.`, { field: key })
  if (opts.integer && !Number.isInteger(n)) throw badRequest(`${key} must be an integer.`, { field: key })
  if (opts.min !== undefined && n < opts.min) throw badRequest(`${key} must be ≥ ${opts.min}.`, { field: key })
  if (opts.max !== undefined && n > opts.max) throw badRequest(`${key} must be ≤ ${opts.max}.`, { field: key })
  return n
}

export function bool(body: Body, key: string): boolean | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'boolean') throw badRequest(`${key} must be true or false.`, { field: key })
  return v
}

export function uuid(body: Body, key: string, opts: { required?: boolean } = {}): string | null | undefined {
  const v = body[key]
  if (v === undefined) {
    if (opts.required) throw badRequest(`${key} is required.`, { field: key })
    return undefined
  }
  if (v === null || v === '') {
    if (opts.required) throw badRequest(`${key} is required.`, { field: key })
    return null
  }
  if (!isUuidLike(v)) throw badRequest(`${key} must be an id (UUID).`, { field: key })
  return v
}

export function oneOf<T extends string>(body: Body, key: string, values: readonly T[], opts: { required?: boolean } = {}): T | undefined {
  const v = body[key]
  if (v === undefined || v === null) {
    if (opts.required) throw badRequest(`${key} is required.`, { field: key })
    return undefined
  }
  if (typeof v !== 'string' || !(values as readonly string[]).includes(v)) {
    throw badRequest(`${key} must be one of: ${values.join(', ')}.`, { field: key })
  }
  return v as T
}

export function strArray(body: Body, key: string, opts: { max?: number; itemMax?: number } = {}): string[] | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (!Array.isArray(v) || v.some((x) => typeof x !== 'string')) throw badRequest(`${key} must be an array of strings.`, { field: key })
  const list = (v as string[]).map((x) => x.trim()).filter(Boolean)
  if (opts.max && list.length > opts.max) throw badRequest(`${key} has too many items (max ${opts.max}).`, { field: key })
  if (opts.itemMax && list.some((x) => x.length > opts.itemMax!)) throw badRequest(`${key} items are too long (max ${opts.itemMax}).`, { field: key })
  return list
}

export function obj(body: Body, key: string): Record<string, unknown> | undefined {
  const v = body[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'object' || Array.isArray(v)) throw badRequest(`${key} must be an object.`, { field: key })
  return v as Record<string, unknown>
}

/** Query-string uuid (or undefined). */
export function queryUuid(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key)
  if (!v) return undefined
  if (!isUuidLike(v)) throw badRequest(`${key} must be an id (UUID).`, { field: key })
  return v
}

export function queryEnum<T extends string>(url: URL, key: string, values: readonly T[]): T | undefined {
  const v = url.searchParams.get(key)
  if (!v) return undefined
  if (!(values as readonly string[]).includes(v)) throw badRequest(`${key} must be one of: ${values.join(', ')}.`, { field: key })
  return v as T
}

export function isIsoDateOnly(v: unknown): v is string {
  return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())
}

/** ISO date-time body field → ISO string (or null / undefined). */
export function isoDateTime(body: Body, key: string): string | null | undefined {
  const v = body[key]
  if (v === undefined) return undefined
  if (v === null || v === '') return null
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(v) || Number.isNaN(new Date(v).getTime())) {
    throw badRequest(`${key} must be an ISO 8601 date-time.`, { field: key })
  }
  return new Date(v).toISOString()
}

export function httpUrl(body: Body, key: string, opts: { required?: boolean } = {}): string | undefined {
  const v = str(body, key, { required: opts.required, max: 2000 })
  if (!v) return undefined
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error()
  } catch {
    throw badRequest(`${key} must be an http(s) URL.`, { field: key })
  }
  return v
}
