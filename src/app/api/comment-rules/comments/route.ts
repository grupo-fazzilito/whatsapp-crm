import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { loadChannel } from '@/lib/channels/store'
import type { LoadedChannel } from '@/lib/channels'
import { GraphError, loadMetaThread, replyToComment, setMetaCommentHidden } from '@/lib/comments/meta'
import { replyLimit, type ThreadReply } from '@/lib/comments/thread'
import { TiktokError, loadTiktokThread, replyToTiktokComment, setTiktokCommentHidden } from '@/lib/tiktok/api'

type CommentChannel = LoadedChannel & { type: 'instagram' | 'messenger' | 'tiktok' }

/** Network ids: digits, underscores and the sandbox's hex ids. Never a path. */
const isNetworkId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,120}$/.test(v)

async function commentChannel(workspaceId: string, channelId: string | null | undefined): Promise<CommentChannel | null> {
  if (!isUuid(channelId)) return null
  const channel = await loadChannel(workspaceId, channelId)
  if (!channel || (channel.type !== 'instagram' && channel.type !== 'messenger' && channel.type !== 'tiktok')) return null
  return channel as CommentChannel
}

function providerError(err: unknown) {
  const reconnect = (err instanceof GraphError || err instanceof TiktokError) && err.needsReconnect
  return NextResponse.json({ error: reconnect ? 'reconnect' : 'provider', detail: err instanceof Error ? err.message : String(err) }, { status: 502 })
}

/**
 * GET /api/comment-rules/comments?channel_id=&post_id= — admin. The account
 * (name, @, photo) and the comments of one of its posts, read live from
 * Facebook, Instagram or TikTok, each with its replies and whether the account
 * already answered it.
 */
export async function GET(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const channel = await commentChannel(guard.ctx.workspace.id, request.nextUrl.searchParams.get('channel_id'))
  if (!channel) return NextResponse.json({ error: 'channel' }, { status: 400 })
  const postId = request.nextUrl.searchParams.get('post_id')
  if (!isNetworkId(postId)) return NextResponse.json({ error: 'post' }, { status: 400 })
  try {
    return NextResponse.json(channel.type === 'tiktok' ? await loadTiktokThread(channel, postId) : await loadMetaThread(channel, postId))
  } catch (err) {
    return providerError(err)
  }
}

/**
 * POST /api/comment-rules/comments — admin. Acts on one comment as the account:
 *   { channel_id, post_id, comment_id, action: 'reply', text }  public reply under it
 *   { channel_id, post_id, comment_id, action: 'hide' | 'unhide' }
 * Manual, so it uses no tokens.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => ({}))) as { channel_id?: string; post_id?: unknown; comment_id?: unknown; action?: unknown; text?: unknown }
  const channel = await commentChannel(guard.ctx.workspace.id, body.channel_id)
  if (!channel) return NextResponse.json({ error: 'channel' }, { status: 400 })
  if (!isNetworkId(body.post_id) || !isNetworkId(body.comment_id)) return NextResponse.json({ error: 'comment' }, { status: 400 })
  const postId = body.post_id
  const commentId = body.comment_id
  try {
    if (body.action === 'reply') {
      const text = typeof body.text === 'string' ? body.text.trim() : ''
      if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 })
      if (text.length > replyLimit(channel.type)) return NextResponse.json({ error: 'too_long', max: replyLimit(channel.type) }, { status: 400 })
      const id = channel.type === 'tiktok' ? await replyToTiktokComment(channel, postId, commentId, text) : await replyToComment(channel, commentId, text)
      const reply: ThreadReply = { id: id ?? `new-${Date.now()}`, author: channel.name, text, createdAt: new Date().toISOString(), fromAccount: true }
      return NextResponse.json({ reply })
    }
    if (body.action === 'hide' || body.action === 'unhide') {
      const hidden = body.action === 'hide'
      if (channel.type === 'tiktok') await setTiktokCommentHidden(channel, postId, commentId, hidden)
      else await setMetaCommentHidden(channel, commentId, hidden)
      return NextResponse.json({ hidden })
    }
    return NextResponse.json({ error: 'action' }, { status: 400 })
  } catch (err) {
    return providerError(err)
  }
}
