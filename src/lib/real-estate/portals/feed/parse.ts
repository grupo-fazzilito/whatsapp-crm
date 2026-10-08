import { localName, parseXml, type XmlNode } from './xml'

// Turns an agency's exported listing data (XML / JSON / CSV) into flat
// records: one per listing, keyed by a "path" inside the listing
// ("titulo", "ubicacion/distrito", "fotos/foto", "precio@moneda").
// Repeated values (photos) become arrays. Pure and client-safe.

export type FeedFormat = 'xml' | 'json' | 'csv'
export type FlatValue = string | string[]
export type FlatRecord = Record<string, FlatValue>

export interface ParsedFeed {
  format: FeedFormat
  /** Path of the repeated element / array that holds one listing. */
  itemPath: string
  records: FlatRecord[]
  /** Every field path seen, in first-seen order. */
  fields: string[]
}

export class FeedError extends Error {
  constructor(public code: 'empty' | 'format' | 'no_items' | 'too_many', message?: string) {
    super(message ?? code)
  }
}

export const MAX_FEED_ITEMS = 2000
const MAX_FIELDS = 300

export function detectFormat(text: string, hint?: string | null): FeedFormat {
  const h = (hint ?? '').toLowerCase()
  if (h === 'xml' || h === 'json' || h === 'csv') return h
  const t = text.replace(/^﻿/, '').trimStart()
  if (t.startsWith('<')) return 'xml'
  if (t.startsWith('{') || t.startsWith('[')) return 'json'
  return 'csv'
}

export function parseFeed(text: string, opts: { format?: string | null; itemPath?: string | null } = {}): ParsedFeed {
  if (!text || !text.trim()) throw new FeedError('empty')
  const format = detectFormat(text, opts.format === 'auto' ? null : opts.format)
  let out: { itemPath: string; records: FlatRecord[] }
  if (format === 'xml') out = parseXmlFeed(text, opts.itemPath)
  else if (format === 'json') out = parseJsonFeed(text, opts.itemPath)
  else out = { itemPath: '', records: parseCsvRecords(text) }
  if (out.records.length === 0) throw new FeedError('no_items')
  if (out.records.length > MAX_FEED_ITEMS) throw new FeedError('too_many')
  return { format, ...out, fields: collectFields(out.records) }
}

export function collectFields(records: FlatRecord[]): string[] {
  const seen = new Set<string>()
  for (const r of records) {
    for (const k of Object.keys(r)) {
      if (seen.size >= MAX_FIELDS) break
      seen.add(k)
    }
  }
  return [...seen]
}

function push(rec: FlatRecord, key: string, value: string) {
  const v = value.trim()
  if (!v) return
  const cur = rec[key]
  if (cur === undefined) rec[key] = v
  else if (Array.isArray(cur)) cur.push(v)
  else rec[key] = [cur, v]
}

// ------------------------------------------------------------------
// XML
// ------------------------------------------------------------------

/** All element paths (from the root, local names) with how often each repeats under one parent. */
function repeatedPaths(root: XmlNode): Map<string, number> {
  const best = new Map<string, number>()
  const walk = (node: XmlNode, path: string, depth: number) => {
    if (depth > 8) return
    const counts = new Map<string, number>()
    for (const c of node.children) counts.set(localName(c.name), (counts.get(localName(c.name)) ?? 0) + 1)
    for (const c of node.children) {
      const p = `${path}/${localName(c.name)}`
      const count = counts.get(localName(c.name)) ?? 0
      // Only elements that have children of their own can be a listing.
      if (c.children.length > 0) best.set(p, Math.max(best.get(p) ?? 0, count))
      walk(c, p, depth + 1)
    }
  }
  walk(root, localName(root.name), 0)
  return best
}

function nodesAt(root: XmlNode, path: string): XmlNode[] {
  const parts = path.split('/').filter(Boolean)
  if (parts[0] !== localName(root.name)) return []
  let level = [root]
  for (const part of parts.slice(1)) level = level.flatMap((n) => n.children.filter((c) => localName(c.name) === part))
  return level
}

function flattenXml(node: XmlNode, prefix: string, rec: FlatRecord, depth = 0) {
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k.startsWith('xmlns')) continue
    push(rec, `${prefix}@${localName(k)}`, v)
  }
  if (node.children.length === 0 || depth > 6) {
    if (prefix) push(rec, prefix, node.text)
    return
  }
  if (prefix && node.text.trim()) push(rec, prefix, node.text)
  for (const c of node.children) flattenXml(c, prefix ? `${prefix}/${localName(c.name)}` : localName(c.name), rec, depth + 1)
}

function parseXmlFeed(text: string, itemPath?: string | null): { itemPath: string; records: FlatRecord[] } {
  let root: XmlNode
  try {
    root = parseXml(text)
  } catch (e) {
    throw new FeedError('format', e instanceof Error ? e.message : 'Invalid XML')
  }
  let path = itemPath && nodesAt(root, itemPath).length ? itemPath : ''
  if (!path) {
    // The listing element is the one repeated the most; ties → shallowest.
    const ranked = [...repeatedPaths(root)].sort((a, b) => b[1] - a[1] || a[0].split('/').length - b[0].split('/').length)
    path = ranked[0]?.[0] ?? ''
    // A single listing in the file: its element has children but no siblings.
    if (!path) path = localName(root.name)
  }
  const records = nodesAt(root, path).map((n) => {
    const rec: FlatRecord = {}
    flattenXml(n, '', rec)
    return rec
  })
  return { itemPath: path, records: records.filter((r) => Object.keys(r).length > 0) }
}

// ------------------------------------------------------------------
// JSON
// ------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Path ('' = root) of the largest array of objects, searched breadth-first up to depth 4. */
function findJsonArray(data: unknown): string | null {
  let best: { path: string; len: number } | null = null
  const queue: { v: unknown; path: string; depth: number }[] = [{ v: data, path: '', depth: 0 }]
  while (queue.length) {
    const { v, path, depth } = queue.shift()!
    if (Array.isArray(v)) {
      const objs = v.filter(isObj).length
      if (objs > 0 && objs >= v.length / 2 && (!best || objs > best.len)) best = { path, len: objs }
      continue
    }
    if (isObj(v) && depth < 4) {
      for (const [k, child] of Object.entries(v)) queue.push({ v: child, path: path ? `${path}/${k}` : k, depth: depth + 1 })
    }
  }
  return best ? best.path : null
}

function jsonAt(data: unknown, path: string): unknown {
  let cur = data
  for (const part of path.split('/').filter(Boolean)) cur = isObj(cur) ? cur[part] : undefined
  return cur
}

function flattenJson(v: unknown, prefix: string, rec: FlatRecord, depth = 0) {
  if (v === null || v === undefined || depth > 6) return
  if (Array.isArray(v)) {
    for (const item of v) flattenJson(item, prefix, rec, depth + 1)
    return
  }
  if (isObj(v)) {
    for (const [k, child] of Object.entries(v)) flattenJson(child, prefix ? `${prefix}/${k}` : k, rec, depth + 1)
    return
  }
  if (prefix) push(rec, prefix, String(v))
}

function parseJsonFeed(text: string, itemPath?: string | null): { itemPath: string; records: FlatRecord[] } {
  let data: unknown
  try {
    data = JSON.parse(text.replace(/^﻿/, ''))
  } catch (e) {
    throw new FeedError('format', e instanceof Error ? e.message : 'Invalid JSON')
  }
  let path: string | null = itemPath ?? null
  if (path === null || !Array.isArray(jsonAt(data, path))) path = findJsonArray(data)
  let items: unknown[]
  if (path === null) {
    if (!isObj(data)) throw new FeedError('no_items')
    items = [data]
    path = ''
  } else items = jsonAt(data, path) as unknown[]
  const records = items.filter(isObj).map((o) => {
    const rec: FlatRecord = {}
    flattenJson(o, '', rec)
    return rec
  })
  return { itemPath: path, records: records.filter((r) => Object.keys(r).length > 0) }
}

// ------------------------------------------------------------------
// CSV
// ------------------------------------------------------------------

/** RFC 4180-ish CSV parser; delimiter auto-detected among , ; tab |. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const firstLine = src.slice(0, src.search(/\r?\n|$/))
  const delims = [',', ';', '\t', '|']
  const delim = delims.map((d) => ({ d, c: firstLine.split(d).length })).sort((a, b) => b.c - a.c)[0].d
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else quoted = false
      } else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === delim) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

/** Header row + data rows → records (header names are the field paths). */
export function matrixToRecords(matrix: unknown[][]): FlatRecord[] {
  const nonEmpty = matrix.filter((r) => Array.isArray(r) && r.some((c) => String(c ?? '').trim() !== ''))
  if (nonEmpty.length < 2) return []
  const headers = nonEmpty[0].map((h, i) => String(h ?? '').trim() || `col${i + 1}`)
  return nonEmpty.slice(1).map((r) => {
    const rec: FlatRecord = {}
    headers.forEach((h, i) => {
      const v = r[i]
      if (v !== undefined && v !== null) push(rec, h, String(v))
    })
    return rec
  })
}

export function parseCsvRecords(text: string): FlatRecord[] {
  return matrixToRecords(parseCsv(text))
}
