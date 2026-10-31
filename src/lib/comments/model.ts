// Keyword auto-replies to comments on the business's Instagram and
// Facebook posts. Pure: webhook parsing, rule matching, reply text.

export type CommentChannelType = 'instagram' | 'messenger'

/** A new comment from a customer on one of the business's posts. */
export interface CommentEvent {
  channelType: CommentChannelType
  /** Instagram account id / Facebook page id (the channel's external_id). */
  channelExternalId: string
  commentId: string
  postId: string | null
  /** Set when the comment answers another comment. */
  parentId: string | null
  from: { id: string; name: string | null }
  text: string
}

interface Change {
  field?: string
  value?: Record<string, unknown>
}

export interface CommentWebhookBody {
  object?: string
  entry?: { id: string; changes?: Change[] }[]
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

/**
 * Instagram `comments` and Facebook page `feed` webhook changes → new
 * customer comments. The account's own comments (our replies) are left
 * out, so a reply never triggers another one.
 */
export function parseCommentWebhook(body: CommentWebhookBody): CommentEvent[] {
  const out: CommentEvent[] = []
  const type: CommentChannelType | null = body.object === 'instagram' ? 'instagram' : body.object === 'page' ? 'messenger' : null
  if (!type) return out
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const v = change.value ?? {}
      if (type === 'instagram') {
        if (change.field !== 'comments') continue
        const from = v.from as { id?: string; username?: string } | undefined
        const commentId = str(v.id)
        // The account's own replies under a comment are Whasalia's public answers (or a person's), never a lead.
        if (!commentId || !from?.id || (from.id === entry.id && v.parent_id)) continue
        out.push({
          channelType: type,
          channelExternalId: entry.id,
          commentId,
          postId: str((v.media as { id?: string } | undefined)?.id),
          parentId: str(v.parent_id),
          from: { id: from.id, name: str(from.username) },
          text: str(v.text) ?? '',
        })
      } else {
        if (change.field !== 'feed' || v.item !== 'comment' || v.verb !== 'add') continue
        const from = v.from as { id?: string; name?: string } | undefined
        const commentId = str(v.comment_id)
        const postId = str(v.post_id)
        const parentId = str(v.parent_id)
        if (!commentId || !from?.id || (from.id === entry.id && parentId && parentId !== postId)) continue
        out.push({
          channelType: type,
          channelExternalId: entry.id,
          commentId,
          postId,
          // A top-level comment's parent is the post itself.
          parentId: parentId && parentId !== postId ? parentId : null,
          from: { id: from.id, name: str(from.name) },
          text: str(v.message) ?? '',
        })
      }
    }
  }
  return out
}

/** Lowercase, without accents or punctuation, single spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Whole words: "info" matches "más info por favor" but not "informal". Empty list = every comment. */
export function matchesKeywords(text: string, keywords: string[]): boolean {
  const words = keywords.map(normalizeText).filter(Boolean)
  if (words.length === 0) return true
  const hay = ` ${normalizeText(text)} `
  return words.some((w) => hay.includes(` ${w} `))
}

export interface RuleForMatch {
  id: string
  channel_id: string | null
  post_id: string | null
  keywords: string[]
  enabled: boolean
  position: number
}

/**
 * First enabled rule (by position) for this comment. Rules for one post
 * win over rules for every post, so "price on this reel" can override a
 * general "price" rule.
 */
export function pickRule<R extends RuleForMatch>(rules: R[], c: { channelId: string; postId: string | null; text: string }): R | null {
  const fits = rules
    .filter((r) => r.enabled && (!r.channel_id || r.channel_id === c.channelId) && (!r.post_id || r.post_id === c.postId))
    .filter((r) => matchesKeywords(c.text, r.keywords))
    .sort((a, b) => Number(!!b.post_id) - Number(!!a.post_id) || a.position - b.position)
  return fits[0] ?? null
}

/** {nombre}/{name} → the commenter's first name (or nothing). */
export function fillReply(template: string, name: string | null): string {
  const first = (name ?? '').trim().split(/\s+/)[0]?.replace(/^@/, '') ?? ''
  return template
    .replace(/\s*\{(nombre|name)\}/gi, (m) => (first ? `${m.startsWith(' ') ? ' ' : ''}${first}` : ''))
    .replace(/\s+([,.!?])/g, '$1')
    .trim()
}

/** One of the public replies, so the same text isn't posted over and over. */
export function pickPublicReply(replies: string[], random: () => number = Math.random): string | null {
  const list = replies.map((r) => r.trim()).filter(Boolean)
  if (list.length === 0) return null
  return list[Math.floor(random() * list.length) % list.length]
}

/** Clean a rule from the editor. Returns an error key instead of throwing. */
export function parseRuleInput(body: unknown):
  | { ok: true; rule: { name: string; channel_id: string | null; post_id: string | null; post_label: string | null; keywords: string[]; public_replies: string[]; private_message: string | null; enabled: boolean } }
  | { ok: false; error: 'name' | 'reply' | 'too_long' } {
  const b = (body ?? {}) as Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
  const list = (v: unknown, max: number, each: number) =>
    Array.isArray(v) ? [...new Set(v.map((x) => text(x, each)).filter(Boolean))].slice(0, max) : []
  const name = text(b.name, 80)
  if (!name) return { ok: false, error: 'name' }
  const keywords = list(b.keywords, 30, 60)
  const public_replies = list(b.public_replies, 10, 2200)
  const private_message = text(b.private_message, 2000) || null
  if (public_replies.length === 0 && !private_message) return { ok: false, error: 'reply' }
  // Instagram caps comment text at 2,200 characters and Messenger texts at 2,000.
  if ((typeof b.private_message === 'string' && b.private_message.trim().length > 2000)) return { ok: false, error: 'too_long' }
  return {
    ok: true,
    rule: {
      name,
      channel_id: text(b.channel_id, 64) || null,
      post_id: text(b.post_id, 128) || null,
      post_label: text(b.post_label, 200) || null,
      keywords,
      public_replies,
      private_message,
      enabled: b.enabled !== false,
    },
  }
}
