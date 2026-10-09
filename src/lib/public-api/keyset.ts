import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { prisma } from '@/lib/db/prisma'
import { normalizeRaw } from '@/lib/db/compat'
import { decodeCursor, pageOf, parseLimit, type Cursor } from './pagination'

// Keyset pagination for /api/v1 lists on Prisma (replaces ./list.ts, which
// paged a PostgREST query builder). Same contract: rows ordered by
// (column desc, id desc), cursor = [sort value, id], limit+1 fetch.
//
// Timestamps are stored with microseconds but Prisma reads and filters
// them as JS Dates (milliseconds). To keep the keyset exact, the cursor
// carries the microsecond value (read with SQL) and rows inside the
// cursor's millisecond are compared in SQL.

export type SortColumn = 'created_at' | 'updated_at'

/** Tables listed by the public API (identifiers interpolated into SQL). */
const TABLES = new Set(['contacts', 'conversations', 'messages', 'orders', 'products', 'bookings', 'deals', 'tasks'])
const COLUMNS = new Set<SortColumn>(['created_at', 'updated_at'])

type Where = Record<string, unknown>

export interface KeysetArgs<R> {
  workspaceId: string
  table: string
  column: SortColumn
  /** Prisma filter of the list (the tenant client adds workspace_id). */
  where: Where
  url: URL
  /** Runs the model's findMany with the list's select/include. */
  findMany: (args: { where: Where; orderBy: Record<string, 'desc'>[]; take: number }) => Promise<R[]>
}

function ident(table: string, column: SortColumn) {
  if (!TABLES.has(table) || !COLUMNS.has(column)) throw new Error(`keyset: unsupported ${table}.${column}`)
  return { t: Prisma.raw(`public."${table}"`), c: Prisma.raw(`"${column}"`) }
}

/** Prisma filter for the rows strictly after `cursor` in (column desc, id desc). */
export async function afterCursorWhere(workspaceId: string, table: string, column: SortColumn, cursor: Cursor): Promise<Where> {
  const { t, c } = ident(table, column)
  const [row] = normalizeRaw(
    await prisma.$queryRaw<{ b: string; ids: string[] | null }[]>`
      WITH k AS (SELECT ${cursor.v}::timestamptz AS v, date_trunc('milliseconds', ${cursor.v}::timestamptz) AS b)
      SELECT k.b,
             ARRAY(
               SELECT x.id::text FROM ${t} x
                WHERE x.workspace_id = ${workspaceId}::uuid
                  AND x.${c} >= k.b AND x.${c} < k.b + interval '1 millisecond'
                  AND (x.${c}, x.id) < (k.v, ${cursor.id}::uuid)
             ) AS ids
        FROM k`,
  )
  // Earlier milliseconds are after the cursor; inside the cursor's own
  // millisecond, the rows SQL found after it (exact, microseconds).
  return { OR: [{ [column]: { lt: row.b } }, { id: { in: row.ids ?? [] } }] }
}

/** Exact (microsecond) sort value of a row, as the next cursor's value. */
async function exactSortValue(workspaceId: string, table: string, column: SortColumn, id: string, seen: unknown): Promise<string | null> {
  if (typeof seen !== 'string') return null
  const { t, c } = ident(table, column)
  const rows = await prisma.$queryRaw<{ v: string | null }[]>`
    SELECT to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS v
      FROM ${t}
     WHERE id = ${id}::uuid AND workspace_id = ${workspaceId}::uuid
       AND date_trunc('milliseconds', ${c}) = ${seen}::timestamptz`
  // Row changed since the page was read: fall back to what the page saw.
  return rows[0]?.v ?? seen
}

export async function keysetPage<R extends { id: string }>(args: KeysetArgs<R>): Promise<{ data: R[]; next_cursor: string | null }> {
  const limit = parseLimit(args.url.searchParams.get('limit'))
  const cursor = decodeCursor(args.url.searchParams.get('cursor'))
  const where = cursor
    ? { AND: [args.where, await afterCursorWhere(args.workspaceId, args.table, args.column, cursor)] }
    : args.where
  const rows = await args.findMany({ where, orderBy: [{ [args.column]: 'desc' }, { id: 'desc' }], take: limit + 1 })
  const last = rows.length > limit ? rows[limit - 1] : null
  const v = last
    ? await exactSortValue(args.workspaceId, args.table, args.column, last.id, (last as Record<string, unknown>)[args.column])
    : null
  return pageOf<R>(rows, limit, () => v)
}

/** Prisma `select` for a plain PostgREST column list ("id, name, …"). */
export function selectOf(columns: string): Record<string, true> {
  return Object.fromEntries(columns.split(',').map((c) => [c.trim(), true]))
}
