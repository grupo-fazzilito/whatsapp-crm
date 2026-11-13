import { NextResponse, type NextRequest } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { loadChannel } from '@/lib/channels/store'
import { GraphError, listRecentPosts } from '@/lib/comments/meta'
import { TiktokError, listVideos } from '@/lib/tiktok/api'

/** GET /api/comment-rules/posts?channel_id= — latest posts of an Instagram / Facebook / TikTok account, to aim a rule at one. */
export async function GET(request: NextRequest) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const channelId = request.nextUrl.searchParams.get('channel_id')
  if (!isUuid(channelId)) return NextResponse.json({ error: 'channel' }, { status: 400 })
  const channel = await loadChannel(guard.ctx.workspace.id, channelId)
  if (!channel || (channel.type !== 'instagram' && channel.type !== 'messenger' && channel.type !== 'tiktok')) return NextResponse.json({ error: 'channel' }, { status: 400 })
  try {
    return NextResponse.json({ posts: channel.type === 'tiktok' ? await listVideos(channel) : await listRecentPosts(channel) })
  } catch (err) {
    const reconnect = (err instanceof GraphError || err instanceof TiktokError) && err.needsReconnect
    return NextResponse.json({ error: reconnect ? 'reconnect' : 'provider', detail: err instanceof Error ? err.message : String(err) }, { status: 502 })
  }
}
