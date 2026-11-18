import 'server-only'
import type { LoadedChannel } from '@/lib/channels'
import { fromFacebook, fromInstagram, type FbComment, type IgComment, type Thread } from './thread'

// Graph API calls for comments, with the channel's page token.
//   Instagram: reply  POST /{ig-comment-id}/replies     (instagram_manage_comments)
//              posts  GET  /{ig-user-id}/media           (instagram_basic)
//   Facebook:  reply  POST /{comment-id}/comments        (pages_manage_engagement)
//              posts  GET  /{page-id}/posts              (pages_read_engagement)
//   Both:      private reply POST /{page-id}/messages {recipient: {comment_id}}
//              — one direct message per comment, within 7 days of it.

const GRAPH = 'https://graph.facebook.com/v21.0'

export class GraphError extends Error {
  constructor(message: string, readonly code: number | null) {
    super(message)
    this.name = 'GraphError'
  }
  /** Missing permission or token: the channel has to be connected again. */
  get needsReconnect() {
    return this.code === 10 || this.code === 190 || (this.code !== null && this.code >= 200 && this.code < 300)
  }
}

function token(channel: LoadedChannel): string {
  const t = channel.secrets.access_token
  if (!t) throw new GraphError('Channel token missing', 190)
  return t
}

async function graph<T>(channel: LoadedChannel, path: string, init?: { body: Record<string, unknown> }): Promise<T> {
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token(channel))}`, {
    method: init ? 'POST' : 'GET',
    headers: init ? { 'Content-Type': 'application/json' } : undefined,
    body: init ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) throw new GraphError(data?.error?.message ?? `Meta API error: ${res.status}`, data?.error?.code ?? null)
  return data as T
}

const pageIdOf = (channel: LoadedChannel) => (channel.settings.page_id as string | undefined) ?? channel.external_id

/** Public reply under the comment; returns the new comment id. */
export async function replyToComment(channel: LoadedChannel, commentId: string, message: string): Promise<string | null> {
  const edge = channel.type === 'instagram' ? 'replies' : 'comments'
  const data = await graph<{ id?: string }>(channel, `${encodeURIComponent(commentId)}/${edge}`, { body: { message } })
  return data.id ?? null
}

/** Direct message to the person who wrote the comment. */
export async function sendPrivateReply(channel: LoadedChannel, commentId: string, text: string): Promise<{ recipientId: string | null; messageId: string | null }> {
  const data = await graph<{ recipient_id?: string; message_id?: string }>(channel, `${encodeURIComponent(pageIdOf(channel))}/messages`, {
    body: { recipient: { comment_id: commentId }, message: { text } },
  })
  return { recipientId: data.recipient_id ?? null, messageId: data.message_id ?? null }
}

export interface RecentPost {
  id: string
  text: string
  imageUrl: string | null
  permalink: string | null
  createdAt: string | null
}

/** Latest posts of the account, to point a rule at one of them. */
export async function listRecentPosts(channel: LoadedChannel, limit = 24): Promise<RecentPost[]> {
  if (channel.type === 'instagram') {
    const data = await graph<{ data?: { id: string; caption?: string; media_type?: string; media_url?: string; thumbnail_url?: string; permalink?: string; timestamp?: string }[] }>(
      channel,
      `${encodeURIComponent(channel.external_id)}/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=${limit}`,
    )
    return (data.data ?? []).map((m) => ({
      id: m.id,
      text: m.caption ?? '',
      imageUrl: m.media_type === 'VIDEO' ? m.thumbnail_url ?? null : m.media_url ?? m.thumbnail_url ?? null,
      permalink: m.permalink ?? null,
      createdAt: m.timestamp ?? null,
    }))
  }
  const data = await graph<{ data?: { id: string; message?: string; full_picture?: string; permalink_url?: string; created_time?: string }[] }>(
    channel,
    `${encodeURIComponent(pageIdOf(channel))}/posts?fields=id,message,full_picture,permalink_url,created_time&limit=${limit}`,
  )
  return (data.data ?? []).map((p) => ({
    id: p.id,
    text: p.message ?? '',
    imageUrl: p.full_picture ?? null,
    permalink: p.permalink_url ?? null,
    createdAt: p.created_time ?? null,
  }))
}

// Comment viewer (read: pages_read_user_content / instagram_manage_comments;
// hide and reply: pages_manage_engagement / instagram_manage_comments).
//   Facebook: GET  /{page-id}?fields=name,picture        the Page shown on top
//             GET  /{post-id}/comments                   top-level comments + replies
//             POST /{comment-id} {is_hidden}             hide / show
//   Instagram: GET /{ig-user-id}?fields=username,name,profile_picture_url
//             GET  /{media-id}/comments                  comments + replies
//             POST /{ig-comment-id} {hide}               hide / show

/** The account and the comments of one of its posts, read live. */
export async function loadMetaThread(channel: LoadedChannel, postId: string): Promise<Thread> {
  if (channel.type === 'instagram') {
    const [me, list] = await Promise.all([
      graph<{ username?: string; name?: string; profile_picture_url?: string }>(channel, `${encodeURIComponent(channel.external_id)}?fields=username,name,profile_picture_url`),
      graph<{ data?: IgComment[] }>(
        channel,
        `${encodeURIComponent(postId)}/comments?fields=id,text,username,timestamp,hidden,from{id,username},replies{id,text,username,timestamp,from{id,username}}&limit=50`,
      ),
    ])
    const username = me.username ?? null
    return {
      account: { name: me.name ?? username ?? channel.name, handle: username, avatar: me.profile_picture_url ?? null },
      comments: fromInstagram(list.data ?? [], channel.external_id, username),
    }
  }
  const pageId = pageIdOf(channel)
  const [page, list] = await Promise.all([
    graph<{ name?: string; picture?: { data?: { url?: string } } }>(channel, `${encodeURIComponent(pageId)}?fields=name,picture`),
    graph<{ data?: FbComment[] }>(
      channel,
      `${encodeURIComponent(postId)}/comments?filter=toplevel&order=reverse_chronological&limit=50&fields=id,message,created_time,from{id,name},is_hidden,can_hide,comments.limit(25){id,message,created_time,from{id,name}}`,
    ),
  ])
  const name = page.name ?? channel.name
  return { account: { name, handle: null, avatar: page.picture?.data?.url ?? null }, comments: fromFacebook(list.data ?? [], pageId, name) }
}

/** Hide (or show again) a comment on the business's post. */
export async function setMetaCommentHidden(channel: LoadedChannel, commentId: string, hidden: boolean): Promise<void> {
  await graph(channel, encodeURIComponent(commentId), { body: channel.type === 'instagram' ? { hide: hidden } : { is_hidden: hidden } })
}
