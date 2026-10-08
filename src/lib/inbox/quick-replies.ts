import type { AttachmentType, QuickReply, QuickReplyAttachment } from './types'

/** Variables a quick reply body may use, replaced when inserted. */
export const QUICK_REPLY_VARIABLES = ['nombre', 'negocio', 'agente', 'fecha'] as const
export type QuickReplyVariable = (typeof QUICK_REPLY_VARIABLES)[number]
export type QuickReplyVars = Partial<Record<QuickReplyVariable, string | null | undefined>>

export const MAX_QUICK_REPLY_ATTACHMENTS = 5
const SHORTCUT_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/**
 * Replaces {nombre} {negocio} {agente} {fecha} (any case). A variable
 * without a value disappears and the spacing around it is tidied, so
 * "Hola {nombre}, ..." becomes "Hola, ..." for an unnamed contact.
 * Unknown {placeholders} are left untouched.
 */
export function renderQuickReply(body: string, vars: QuickReplyVars): string {
  let missing = false
  const out = body.replace(/\{(\w+)\}/g, (whole, raw: string) => {
    const key = raw.toLowerCase()
    if (!(QUICK_REPLY_VARIABLES as readonly string[]).includes(key)) return whole
    const value = vars[key as QuickReplyVariable]?.trim()
    if (!value) {
      missing = true
      return ''
    }
    return value
  })
  if (!missing) return out
  return out
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([,.;:!?])/g, '$1')
    .replace(/([¡¿])[ \t]+/g, '$1')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim()
}

/** "Today" as a long date in the workspace time zone, e.g. "8 de octubre de 2026". */
export function formatToday(timeZone: string | null | undefined, locale: string, now: Date = new Date()): string {
  const lang = locale === 'en' ? 'en-US' : 'es-PE'
  try {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'long', timeZone: timeZone || 'UTC' }).format(now)
  } catch {
    return new Intl.DateTimeFormat(lang, { dateStyle: 'long' }).format(now)
  }
}

/** Lower-case, no leading "/", spaces → "-", only [a-z0-9_-], max 32. */
export function normalizeShortcut(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/^\/+/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/^[-_]+/, '')
    .slice(0, 32)
}

export function isValidShortcut(s: unknown): s is string {
  return typeof s === 'string' && SHORTCUT_RE.test(s)
}

const ATTACHMENT_TYPES: AttachmentType[] = ['image', 'video', 'audio', 'document']

/** Validated attachment list (drops anything malformed); null when the input isn't an array. */
export function normalizeAttachments(raw: unknown, workspaceId?: string): QuickReplyAttachment[] | null {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw)) return null
  const out: QuickReplyAttachment[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const a = item as Record<string, unknown>
    const type = a.type as AttachmentType
    if (!ATTACHMENT_TYPES.includes(type)) continue
    const name = typeof a.name === 'string' && a.name.trim() ? a.name.trim().slice(0, 120) : type
    const path = typeof a.path === 'string' ? a.path : undefined
    const url = typeof a.url === 'string' ? a.url : undefined
    if (path) {
      // Only objects of this workspace's own folder, no traversal.
      if (path.includes('..') || (workspaceId && !path.startsWith(`${workspaceId}/`))) continue
      out.push({ path, type, name })
    } else if (url && /^https:\/\//i.test(url) && url.length <= 2048) {
      out.push({ url, type, name })
    }
    if (out.length >= MAX_QUICK_REPLY_ATTACHMENTS) break
  }
  return out
}

/**
 * Quick replies for the "/query" typed in the composer: shortcut prefix
 * matches first, then shortcut/title contains, then body contains.
 */
export function matchQuickReplies<T extends Pick<QuickReply, 'shortcut' | 'title' | 'body'>>(
  list: T[],
  query: string,
  limit = 8,
): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...list].sort((a, b) => a.shortcut.localeCompare(b.shortcut)).slice(0, limit)
  const scored: { item: T; score: number }[] = []
  for (const item of list) {
    const sc = item.shortcut.toLowerCase()
    const title = item.title.toLowerCase()
    let score = -1
    if (sc.startsWith(q)) score = 0
    else if (sc.includes(q) || title.includes(q)) score = 1
    else if (item.body.toLowerCase().includes(q)) score = 2
    if (score >= 0) scored.push({ item, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.shortcut.localeCompare(b.item.shortcut))
    .slice(0, limit)
    .map((s) => s.item)
}

export interface TokenAtCaret {
  /** Index of the trigger character ("/" or "@"). */
  start: number
  /** Text typed after the trigger, up to the caret. */
  query: string
}

/** "/atajo" being typed right before the caret (at the start or after whitespace). */
export function slashQuery(text: string, caret: number): TokenAtCaret | null {
  const before = text.slice(0, caret)
  const m = before.match(/(^|\s)\/([a-z0-9_-]*)$/i)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

/** Replace text[start, caret) with `insert`; returns the new text and caret. */
export function replaceToken(text: string, start: number, caret: number, insert: string): { text: string; caret: number } {
  const next = text.slice(0, start) + insert + text.slice(caret)
  return { text: next, caret: start + insert.length }
}

/** Validates a create (partial = false) or update body for quick_replies. */
export function parseQuickReplyInput(
  body: Record<string, unknown>,
  workspaceId: string,
  partial: boolean,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  const value: Record<string, unknown> = {}
  if (!partial || 'shortcut' in body) {
    const shortcut = normalizeShortcut(typeof body.shortcut === 'string' ? body.shortcut : '')
    if (!isValidShortcut(shortcut)) return { ok: false, error: 'invalid_shortcut' }
    value.shortcut = shortcut
  }
  if (!partial || 'title' in body) {
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 80) : ''
    if (!title) return { ok: false, error: 'title_required' }
    value.title = title
  }
  if (!partial || 'body' in body) {
    const text = typeof body.body === 'string' ? body.body.replace(/\u0000/g, '').trim() : ''
    if (text.length > 4096) return { ok: false, error: 'body_too_long' }
    value.body = text
  }
  if (!partial || 'attachments' in body) {
    const attachments = normalizeAttachments(body.attachments, workspaceId)
    if (!attachments) return { ok: false, error: 'invalid_attachments' }
    value.attachments = attachments
  }
  if (!partial && !value.body && !(value.attachments as unknown[]).length) {
    return { ok: false, error: 'empty_reply' }
  }
  if ('is_shared' in body) value.is_shared = body.is_shared === true
  return { ok: true, value }
}
