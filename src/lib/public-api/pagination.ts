// Cursor pagination for /api/v1 lists. Lists are ordered by a sort
// column (created_at / updated_at) descending, ties broken by id
// descending. The cursor is an opaque base64url JSON {v: sort value, id}.

export const DEFAULT_LIMIT = 25
export const MAX_LIMIT = 100

export interface Cursor {
  v: string
  id: string
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.v, c.id]), 'utf8').toString('base64url')
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// What Postgres/PostgREST returns for timestamptz, or a plain ISO string.
const TS_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/

/** Null for a missing cursor; throws 'invalid_cursor' for a malformed one. */
export function decodeCursor(raw: string | null | undefined): Cursor | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (Array.isArray(parsed) && parsed.length === 2) {
      const [v, id] = parsed
      if (typeof v === 'string' && TS_RE.test(v) && typeof id === 'string' && UUID_RE.test(id)) return { v, id }
    }
  } catch {
    // fall through
  }
  throw new Error('invalid_cursor')
}

export function parseLimit(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || raw === '') return DEFAULT_LIMIT
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1) throw new Error('invalid_limit')
  return Math.min(n, MAX_LIMIT)
}

/**
 * PostgREST `or` filter selecting rows strictly after the cursor in
 * (column desc, id desc) order.
 */
export function cursorFilter(column: string, c: Cursor): string {
  const v = `"${c.v.replace(/"/g, '')}"`
  return `${column}.lt.${v},and(${column}.eq.${v},id.lt.${c.id})`
}

/**
 * Given limit+1 fetched rows, the page and the next cursor (null when
 * this is the last page).
 */
export function pageOf<T extends { id: string }>(rows: T[], limit: number, sortValue: (row: T) => string | null): { data: T[]; next_cursor: string | null } {
  const hasMore = rows.length > limit
  const data = hasMore ? rows.slice(0, limit) : rows
  const last = data[data.length - 1]
  const v = last ? sortValue(last) : null
  return { data, next_cursor: hasMore && last && v ? encodeCursor({ v, id: last.id }) : null }
}

/** ISO-8601 date-time query parameter → ISO string (throws 'invalid_date'). */
export function parseIsoParam(raw: string | null | undefined): string | null {
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime()) || !/^\d{4}-\d{2}-\d{2}/.test(raw)) throw new Error('invalid_date')
  return d.toISOString()
}
