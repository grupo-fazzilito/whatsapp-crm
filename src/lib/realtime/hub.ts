import 'server-only'
import { Client } from 'pg'
import { prisma } from '@/lib/db/prisma'
import { REALTIME_TABLES, type RealtimeChange, type RealtimeTable } from './types'

// One LISTEN connection per server process; changes fan out to the SSE
// subscribers of the same workspace (see /api/realtime).

interface Subscriber {
  workspaceId: string
  userId: string
  send: (change: RealtimeChange) => void
}

interface HubState {
  client: Client | null
  connecting: Promise<void> | null
  subs: Set<Subscriber>
}

const g = globalThis as unknown as { realtimeHub?: HubState }
const hub: HubState = (g.realtimeHub ??= { client: null, connecting: null, subs: new Set() })

const TABLES = new Set<string>(REALTIME_TABLES)

interface Notice {
  t: string
  op: 'INSERT' | 'UPDATE' | 'DELETE'
  ws: string | null
  id: string | null
  old: Record<string, unknown> | null
}

type FindById = { findUnique(args: { where: { id: string } }): Promise<Record<string, unknown> | null> }

async function loadRow(table: RealtimeTable, id: string): Promise<Record<string, unknown> | null> {
  const model = (prisma as unknown as Record<string, FindById>)[table]
  return model.findUnique({ where: { id } }).catch(() => null)
}

/** Who may see a change: same workspace; notifications only their recipient. */
export function audience(change: RealtimeChange, sub: Pick<Subscriber, 'userId'>): boolean {
  if (change.table !== 'notifications') return true
  const row = change.eventType === 'DELETE' ? change.old : change.new
  return (row as { user_id?: unknown }).user_id === sub.userId
}

async function dispatch(raw: string) {
  let n: Notice
  try {
    n = JSON.parse(raw) as Notice
  } catch {
    return
  }
  if (!n.ws || !n.id || !TABLES.has(n.t)) return
  const targets = [...hub.subs].filter((s) => s.workspaceId === n.ws)
  if (!targets.length) return
  const table = n.t as RealtimeTable
  let change: RealtimeChange
  if (n.op === 'DELETE') {
    change = { table, eventType: 'DELETE', new: {}, old: n.old ?? { id: n.id } }
  } else {
    const row = await loadRow(table, n.id)
    if (!row) return
    change = { table, eventType: n.op, new: row, old: { id: n.id } }
  }
  for (const s of targets) if (audience(change, s)) s.send(change)
}

async function connect(): Promise<void> {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const client = new Client({ connectionString })
  client.on('notification', (msg) => {
    if (msg.channel === 'app_changes' && msg.payload) void dispatch(msg.payload)
  })
  const reset = (err?: unknown) => {
    if (hub.client !== client) return
    if (err) console.warn('[realtime] listener lost:', err instanceof Error ? err.message : err)
    hub.client = null
    client.end().catch(() => {})
    // Reconnect while someone is listening.
    if (hub.subs.size) setTimeout(() => void ensureListener().catch(() => {}), 2000)
  }
  client.on('error', reset)
  client.on('end', () => reset())
  await client.connect()
  await client.query('LISTEN app_changes')
  hub.client = client
}

export async function ensureListener(): Promise<void> {
  if (hub.client) return
  if (!hub.connecting) {
    hub.connecting = connect().finally(() => {
      hub.connecting = null
    })
  }
  return hub.connecting
}

/** Registers an SSE subscriber; returns the unsubscribe function. */
export async function subscribe(sub: Subscriber): Promise<() => void> {
  hub.subs.add(sub)
  await ensureListener()
  return () => {
    hub.subs.delete(sub)
  }
}
