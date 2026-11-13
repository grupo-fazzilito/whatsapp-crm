import 'server-only'
import { findChannelByExternalId } from '@/lib/channels/store'
import type { LoadedChannel } from '@/lib/channels'
import { handleComment, type CommentOutcome } from '@/lib/comments/server'
import { getComment } from './api'
import type { TiktokCommentEvent } from './model'

// TikTok comment.update events → the same comment rules as Instagram and
// Facebook (public replies only: TikTok has no private reply to a comment).

/** A new top-level comment from a customer, ready for the rules. */
export async function answerTiktokComment(
  channel: LoadedChannel,
  c: { commentId: string; videoId: string; authorId: string; authorName: string | null; text: string },
): Promise<CommentOutcome> {
  return handleComment(channel, {
    channelType: 'tiktok',
    channelExternalId: channel.external_id,
    commentId: c.commentId,
    postId: c.videoId,
    parentId: null,
    from: { id: c.authorId, name: c.authorName },
    text: c.text,
  })
}

export async function handleTiktokCommentEvent(ev: TiktokCommentEvent): Promise<CommentOutcome | 'ignored'> {
  // Only new top-level comments: replies under a comment include our own answers.
  if (ev.action !== 'insert' || ev.type !== 'comment') return 'ignored'
  const channel = await findChannelByExternalId('tiktok', ev.openId)
  if (!channel || channel.status !== 'connected') return 'ignored'

  // The event doesn't say who wrote the comment (nor whether it was the account itself).
  let detail: Awaited<ReturnType<typeof getComment>> = null
  try {
    detail = await getComment(channel, ev.videoId, ev.commentId)
  } catch (err) {
    console.warn('[tiktok] comment lookup failed:', err instanceof Error ? err.message : err)
  }
  if (detail?.owner) return 'ignored'
  return answerTiktokComment(channel, {
    commentId: ev.commentId,
    videoId: ev.videoId,
    authorId: ev.authorId ?? `comment:${ev.commentId}`,
    authorName: detail?.displayName || (detail?.username ? `@${detail.username}` : null),
    text: detail?.text ?? ev.text,
  })
}
