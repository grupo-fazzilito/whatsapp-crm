// The comments of one post, as the comment viewer shows them, built from the
// raw answers of Facebook, Instagram and TikTok. Pure: no I/O.

export interface ThreadAccount {
  name: string
  handle: string | null
  avatar: string | null
}

export interface ThreadReply {
  id: string
  author: string
  text: string
  createdAt: string | null
  /** Written by the business's own account (a reply from Whasalia included). */
  fromAccount: boolean
}

export interface ThreadComment {
  id: string
  author: string
  text: string
  createdAt: string | null
  hidden: boolean
  /** The network lets the account hide it (never its own comments). */
  canHide: boolean
  fromAccount: boolean
  replies: ThreadReply[]
  /** The account already answered under it. */
  replied: boolean
}

export interface Thread {
  account: ThreadAccount
  comments: ThreadComment[]
}

const iso = (seconds: number | string | undefined | null) => (seconds == null || seconds === '' ? null : new Date(Number(seconds) * 1000).toISOString())

function finish(c: Omit<ThreadComment, 'replied'>): ThreadComment {
  return { ...c, replied: c.replies.some((r) => r.fromAccount) }
}

// Facebook: GET /{post-id}/comments?filter=toplevel&fields=id,message,created_time,from{id,name},is_hidden,can_hide,comments{…}
export interface FbComment {
  id: string
  message?: string
  created_time?: string
  from?: { id?: string; name?: string }
  is_hidden?: boolean
  can_hide?: boolean
  comments?: { data?: FbComment[] }
}

export function fromFacebook(rows: FbComment[], pageId: string, pageName: string): ThreadComment[] {
  const author = (c: FbComment) => c.from?.name ?? (c.from?.id === pageId ? pageName : '—')
  return rows.map((c) =>
    finish({
      id: c.id,
      author: author(c),
      text: c.message ?? '',
      createdAt: c.created_time ?? null,
      hidden: !!c.is_hidden,
      canHide: !!c.can_hide && c.from?.id !== pageId,
      fromAccount: c.from?.id === pageId,
      replies: (c.comments?.data ?? []).map((r) => ({
        id: r.id,
        author: author(r),
        text: r.message ?? '',
        createdAt: r.created_time ?? null,
        fromAccount: r.from?.id === pageId,
      })),
    }),
  )
}

// Instagram: GET /{media-id}/comments?fields=id,text,username,timestamp,hidden,from{id},replies{…}
export interface IgComment {
  id: string
  text?: string
  username?: string
  timestamp?: string
  hidden?: boolean
  from?: { id?: string; username?: string }
  replies?: { data?: IgComment[] }
}

export function fromInstagram(rows: IgComment[], igUserId: string, username: string | null): ThreadComment[] {
  const own = (c: IgComment) => c.from?.id === igUserId || (!!username && (c.username ?? c.from?.username) === username)
  const author = (c: IgComment) => c.username ?? c.from?.username ?? '—'
  return rows.map((c) =>
    finish({
      id: c.id,
      author: author(c),
      text: c.text ?? '',
      createdAt: c.timestamp ?? null,
      hidden: !!c.hidden,
      canHide: !own(c),
      fromAccount: own(c),
      replies: (c.replies?.data ?? []).map((r) => ({ id: r.id, author: author(r), text: r.text ?? '', createdAt: r.timestamp ?? null, fromAccount: own(r) })),
    }),
  )
}

// TikTok: GET /business/comment/list/?include_replies=true — ids already quoted by quoteBigInts.
export interface TtComment {
  comment_id: string | number
  text?: string
  create_time?: number | string
  username?: string
  display_name?: string
  owner?: boolean
  /** PUBLIC or HIDDEN */
  status?: string
  parent_comment_id?: string | number
  reply_list?: TtComment[]
}

export function fromTiktok(rows: TtComment[]): ThreadComment[] {
  const author = (c: TtComment) => c.display_name || c.username || '—'
  return rows
    .filter((c) => c.parent_comment_id == null || c.parent_comment_id === '' || c.parent_comment_id === '0')
    .map((c) =>
      finish({
        id: String(c.comment_id),
        author: author(c),
        text: c.text ?? '',
        createdAt: iso(c.create_time),
        hidden: c.status === 'HIDDEN',
        canHide: !c.owner,
        fromAccount: !!c.owner,
        replies: (c.reply_list ?? []).map((r) => ({ id: String(r.comment_id), author: author(r), text: r.text ?? '', createdAt: iso(r.create_time), fromAccount: !!r.owner })),
      }),
    )
}

/** Longest public reply each network takes. */
export function replyLimit(type: 'instagram' | 'messenger' | 'tiktok'): number {
  return type === 'tiktok' ? 1200 : type === 'instagram' ? 2200 : 8000
}
