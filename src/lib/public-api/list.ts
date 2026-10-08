import 'server-only'
import { cursorFilter, decodeCursor, pageOf, parseLimit } from './pagination'

// Shared keyset pagination over a PostgREST query builder.

interface Filterable<T> {
  or(filter: string): T
  order(column: string, opts: { ascending: boolean }): T
  limit(n: number): T
}

export async function listPage<R extends { id: string }>(
  query: Filterable<unknown>,
  column: string,
  url: URL,
): Promise<{ data: R[]; next_cursor: string | null }> {
  const limit = parseLimit(url.searchParams.get('limit'))
  const cursor = decodeCursor(url.searchParams.get('cursor'))
  let q = query as Filterable<unknown>
  if (cursor) q = q.or(cursorFilter(column, cursor)) as Filterable<unknown>
  q = q.order(column, { ascending: false }) as Filterable<unknown>
  q = q.order('id', { ascending: false }) as Filterable<unknown>
  const { data, error } = (await (q.limit(limit + 1) as unknown as PromiseLike<{ data: R[] | null; error: { message: string } | null }>))
  if (error) throw new Error(error.message)
  return pageOf<R>(data ?? [], limit, (r) => ((r as Record<string, unknown>)[column] as string) ?? null)
}
