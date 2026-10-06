/**
 * Minimal in-memory stand-in for the Supabase query builder, for unit
 * tests of service-role code (vi.mock('@/lib/supabase/admin')). Supports
 * the subset the engines use: select/insert/update/upsert/delete, the
 * common filters, order/limit, single/maybeSingle, count+head, rpc.
 * Embedded selects ("contact:contacts(name)") are ignored — rows come
 * back as stored.
 */

type Row = Record<string, unknown>
type Op = 'select' | 'insert' | 'update' | 'upsert' | 'delete'

let seq = 0
const newId = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`

function readPath(row: Row, path: string): unknown {
  // "payload->>meta_message_id" / "settings->key"
  const parts = path.split(/->>?/)
  let cur: unknown = row
  for (const p of parts) cur = cur && typeof cur === 'object' ? (cur as Row)[p] : undefined
  return cur
}

class Query implements PromiseLike<{ data: unknown; error: null; count: number | null }> {
  private op: Op = 'select'
  private filters: ((r: Row) => boolean)[] = []
  private payload: Row | Row[] | null = null
  private mode: 'many' | 'single' | 'maybe' = 'many'
  private orderBy: { col: string; asc: boolean } | null = null
  private max: number | null = null
  private head = false
  private wantCount = false

  constructor(private db: FakeDb, private table: string) {}

  private rows(): Row[] {
    return (this.db.tables[this.table] ??= [])
  }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (opts?.head) this.head = true
    if (opts?.count) this.wantCount = true
    return this
  }
  insert(payload: Row | Row[]) {
    this.op = 'insert'
    this.payload = payload
    return this
  }
  upsert(payload: Row | Row[]) {
    this.op = 'upsert'
    this.payload = payload
    return this
  }
  update(payload: Row) {
    this.op = 'update'
    this.payload = payload
    return this
  }
  delete() {
    this.op = 'delete'
    return this
  }
  eq(col: string, v: unknown) {
    this.filters.push((r) => readPath(r, col) === v)
    return this
  }
  neq(col: string, v: unknown) {
    this.filters.push((r) => readPath(r, col) !== v)
    return this
  }
  is(col: string, v: unknown) {
    this.filters.push((r) => (readPath(r, col) ?? null) === v)
    return this
  }
  in(col: string, vs: unknown[]) {
    this.filters.push((r) => vs.includes(readPath(r, col)))
    return this
  }
  gte(col: string, v: string | number) {
    this.filters.push((r) => (readPath(r, col) as string | number) >= v)
    return this
  }
  lte(col: string, v: string | number) {
    this.filters.push((r) => (readPath(r, col) as string | number) <= v)
    return this
  }
  filter(col: string, op: string, v: unknown) {
    if (op === 'eq') return this.eq(col, v)
    return this
  }
  order(col: string, opts?: { ascending?: boolean }) {
    this.orderBy = { col, asc: opts?.ascending ?? true }
    return this
  }
  limit(n: number) {
    this.max = n
    return this
  }
  single() {
    this.mode = 'single'
    return this
  }
  maybeSingle() {
    this.mode = 'maybe'
    return this
  }

  private run(): { data: unknown; error: null; count: number | null } {
    const all = this.rows()
    const match = (r: Row) => this.filters.every((f) => f(r))
    let out: Row[]
    if (this.op === 'insert' || this.op === 'upsert') {
      const list = Array.isArray(this.payload) ? this.payload : [this.payload as Row]
      out = list.map((p) => ({ id: newId(), created_at: new Date().toISOString(), ...p }))
      all.push(...out)
      this.db.log.push({ table: this.table, op: this.op, payload: this.payload })
    } else if (this.op === 'update') {
      out = all.filter(match)
      for (const r of out) Object.assign(r, this.payload)
      this.db.log.push({ table: this.table, op: 'update', payload: this.payload })
    } else if (this.op === 'delete') {
      out = all.filter(match)
      this.db.tables[this.table] = all.filter((r) => !match(r))
    } else {
      out = all.filter(match)
    }
    if (this.orderBy) {
      const { col, asc } = this.orderBy
      out = [...out].sort((a, b) => {
        const x = readPath(a, col) as string
        const y = readPath(b, col) as string
        return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1)
      })
    }
    if (this.max !== null) out = out.slice(0, this.max)
    const count = this.wantCount ? out.length : null
    if (this.head) return { data: null, error: null, count }
    if (this.mode !== 'many') return { data: out[0] ? { ...out[0] } : null, error: null, count }
    return { data: out.map((r) => ({ ...r })), error: null, count }
  }

  then<A = { data: unknown; error: null; count: number | null }, B = never>(
    onfulfilled?: ((value: { data: unknown; error: null; count: number | null }) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.run()).then(onfulfilled, onrejected)
  }
}

export class FakeDb {
  tables: Record<string, Row[]> = {}
  log: { table: string; op: Op; payload: unknown }[] = []

  constructor(seed: Record<string, Row[]> = {}) {
    for (const [k, v] of Object.entries(seed)) this.tables[k] = v.map((r) => ({ ...r }))
  }
  from(table: string) {
    return new Query(this, table)
  }
  rpc() {
    return Promise.resolve({ data: null, error: null })
  }
  rows(table: string): Row[] {
    return this.tables[table] ?? []
  }
}
