'use client'

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { RealtimeChange, RealtimeTable } from './types'

// One EventSource per browser tab (all watched tables, active workspace);
// components register listeners with useRealtimeChanges().

type Listener = (change: RealtimeChange) => void

const listeners = new Set<{ tables: Set<string>; fn: Listener }>()
const statusListeners = new Set<() => void>()
let source: EventSource | null = null
let sourceWs: string | null = null
let connected = false

function setConnected(v: boolean) {
  if (connected === v) return
  connected = v
  statusListeners.forEach((l) => l())
}

function open(workspaceId: string) {
  if (source && sourceWs === workspaceId) return
  source?.close()
  sourceWs = workspaceId
  setConnected(false)
  source = new EventSource('/api/realtime')
  source.addEventListener('ready', () => setConnected(true))
  source.addEventListener('error', () => setConnected(false))
  source.addEventListener('change', (e) => {
    let change: RealtimeChange
    try {
      change = JSON.parse((e as MessageEvent<string>).data) as RealtimeChange
    } catch {
      return
    }
    for (const l of listeners) if (l.tables.has(change.table)) l.fn(change)
  })
}

function closeIfIdle() {
  if (listeners.size === 0 && source) {
    source.close()
    source = null
    sourceWs = null
    setConnected(false)
  }
}

interface Options<T> {
  /** Active workspace id; the stream reconnects when it changes. Null/undefined pauses. */
  workspaceId: string | null | undefined
  tables: RealtimeTable[]
  onChange: (change: RealtimeChange<T>) => void
  enabled?: boolean
}

/** Subscribes to row changes of the active workspace. The latest onChange is always used. */
export function useRealtimeChanges<T = Record<string, unknown>>({ workspaceId, tables, onChange, enabled = true }: Options<T>) {
  const handler = useRef(onChange)
  useEffect(() => {
    handler.current = onChange
  })
  const key = tables.join(',')
  useEffect(() => {
    if (!enabled || !workspaceId) return
    const entry = { tables: new Set<string>(key.split(',')), fn: (c: RealtimeChange) => handler.current(c as RealtimeChange<T>) }
    listeners.add(entry)
    open(workspaceId)
    return () => {
      listeners.delete(entry)
      closeIfIdle()
    }
  }, [enabled, workspaceId, key])
}

/** True while the realtime stream is connected. */
export function useRealtimeConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      statusListeners.add(cb)
      return () => statusListeners.delete(cb)
    },
    () => connected,
    () => false,
  )
}
