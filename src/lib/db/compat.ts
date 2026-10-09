// Keeps Prisma's values in the shapes the app used with Supabase/PostgREST,
// so ported code keeps working:
//   timestamp → ISO string        Decimal → number      BigInt → number
//   DATE      → 'YYYY-MM-DD'      and on input 'YYYY-MM-DD' → Date for DATE columns
// Pure; applied to every query by the client in ./prisma.ts.
import { SCHEMA_META, type FieldKind } from './schema-meta'

type Obj = Record<string, unknown>

function isDecimal(v: unknown): v is { toNumber(): number } {
  return !!v && typeof v === 'object' && typeof (v as { toNumber?: unknown }).toNumber === 'function' && 'd' in (v as object)
}

function plain(v: unknown): v is Obj {
  return !!v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype
}

function outValue(kind: FieldKind | undefined, v: unknown): unknown {
  if (v === null || v === undefined) return v
  if (v instanceof Date) return kind === 'date' ? v.toISOString().slice(0, 10) : v.toISOString()
  if (typeof v === 'bigint') return Number(v)
  if (isDecimal(v)) return v.toNumber()
  return v
}

/** Result of a model query → PostgREST-like plain values (recursive through relations). */
export function normalizeResult(model: string | undefined, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => normalizeResult(model, v))
  if (value instanceof Date || typeof value === 'bigint' || isDecimal(value)) return outValue(undefined, value)
  if (!plain(value)) return value
  const fields = model ? SCHEMA_META[model] : undefined
  const out: Obj = {}
  for (const [k, v] of Object.entries(value)) {
    const kind = fields?.[k]
    if (kind && typeof kind === 'object') out[k] = normalizeResult(kind.rel, v)
    else if (k === '_count' || k === '_sum' || k === '_avg' || k === '_min' || k === '_max') out[k] = normalizeResult(model, v)
    else out[k] = outValue(kind, v)
  }
  return out
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

function inValue(kind: FieldKind | undefined, v: unknown): unknown {
  if (kind === 'date' && typeof v === 'string' && DAY.test(v)) return new Date(`${v}T00:00:00.000Z`)
  if (kind === 'timestamp' && typeof v === 'string' && DAY.test(v)) return new Date(`${v}T00:00:00.000Z`)
  return v
}

const FILTER_KEYS = new Set(['equals', 'not', 'in', 'notIn', 'lt', 'lte', 'gt', 'gte', 'set'])

/** Converts 'YYYY-MM-DD' strings given for DATE columns in data and filters (recursive). */
export function normalizeArgs(model: string | undefined, value: unknown): unknown {
  if (Array.isArray(value)) return value.map((v) => normalizeArgs(model, v))
  if (!plain(value)) return value
  const fields = model ? SCHEMA_META[model] : undefined
  const out: Obj = {}
  for (const [k, v] of Object.entries(value)) {
    const kind = fields?.[k]
    if (kind && typeof kind === 'object') {
      out[k] = normalizeArgs(kind.rel, v)
    } else if (kind === 'date' || kind === 'timestamp') {
      if (plain(v)) {
        const f: Obj = {}
        for (const [op, x] of Object.entries(v)) f[op] = FILTER_KEYS.has(op) ? (Array.isArray(x) ? x.map((y) => inValue(kind, y)) : inValue(kind, x)) : x
        out[k] = f
      } else out[k] = inValue(kind, v)
    } else if (['where', 'data', 'create', 'update', 'AND', 'OR', 'NOT', 'some', 'every', 'none', 'is', 'isNot', 'connectOrCreate', 'upsert', 'createMany', 'updateMany'].includes(k)) {
      out[k] = normalizeArgs(model, v)
    } else out[k] = v
  }
  return out
}

/** Row values of $queryRaw (no model info): Date → ISO, Decimal/BigInt → number. */
export function normalizeRaw<T>(rows: T): T {
  return normalizeResult(undefined, rows) as T
}
