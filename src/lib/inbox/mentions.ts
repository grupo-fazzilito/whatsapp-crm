import type { TokenAtCaret } from './quick-replies'

export interface MentionCandidate {
  userId: string
  name: string
}

function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/** "@ana" being typed right before the caret (at the start or after whitespace). */
export function mentionQuery(text: string, caret: number): TokenAtCaret | null {
  const before = text.slice(0, caret)
  const m = before.match(/(^|\s)@([\p{L}\p{N}._-]*)$/u)
  if (!m) return null
  return { start: caret - m[2].length - 1, query: m[2] }
}

/** Members whose name (any word) starts with the query, or contains it. */
export function filterMentionCandidates<T extends MentionCandidate>(list: T[], query: string, limit = 6): T[] {
  const q = fold(query.trim())
  const named = list.filter((c) => c.name.trim())
  if (!q) return named.slice(0, limit)
  const starts: T[] = []
  const contains: T[] = []
  for (const c of named) {
    const name = fold(c.name)
    if (name.split(/\s+/).some((w) => w.startsWith(q))) starts.push(c)
    else if (name.includes(q)) contains.push(c)
  }
  return [...starts, ...contains].slice(0, limit)
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * User ids mentioned as "@Full Name" in `text` (deduped, in order of
 * appearance). Longer names win, so "@Ana Pérez" never also counts as a
 * mention of a teammate called "Ana".
 */
export function extractMentions(text: string, candidates: MentionCandidate[]): string[] {
  const byName = new Map<string, string[]>()
  for (const c of candidates) {
    const key = fold(c.name.trim())
    if (!key) continue
    byName.set(key, [...(byName.get(key) ?? []), c.userId])
  }
  const out: string[] = []
  for (const seg of splitMentions(text, candidates.map((c) => c.name))) {
    if (!seg.mention) continue
    for (const id of byName.get(fold(seg.text.slice(1))) ?? []) if (!out.includes(id)) out.push(id)
  }
  return out
}

export interface TextSegment {
  text: string
  mention: boolean
}

/** Splits `text` so "@Name" mentions of known names can be highlighted. */
export function splitMentions(text: string, names: string[]): TextSegment[] {
  const clean = [...new Set(names.map((n) => n.trim()).filter(Boolean))].sort((a, b) => b.length - a.length)
  if (!clean.length || !text.includes('@')) return [{ text, mention: false }]
  const re = new RegExp(`@(?:${clean.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'giu')
  const out: TextSegment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0
    // Must start the text or follow a non-word character.
    if (idx > 0 && /[\p{L}\p{N}]/u.test(text[idx - 1])) continue
    if (idx > last) out.push({ text: text.slice(last, idx), mention: false })
    out.push({ text: m[0], mention: true })
    last = idx + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last), mention: false })
  return out.length ? out : [{ text, mention: false }]
}
