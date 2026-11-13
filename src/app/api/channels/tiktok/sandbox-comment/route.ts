import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { loadChannel } from '@/lib/channels/store'
import { tiktokSandbox } from '@/lib/tiktok/config'
import { answerTiktokComment } from '@/lib/tiktok/comments'
import { SANDBOX_ACCOUNT, SANDBOX_VIDEOS, sandboxComment } from '@/lib/tiktok/sandbox'

let round = 0

/**
 * POST /api/channels/tiktok/sandbox-comment — local demo only (TIKTOK_SANDBOX):
 * a sample customer comments on a sample video of the sandbox account and the
 * comment rules answer it, exactly as a real comment.update would.
 */
export async function POST(request: Request) {
  if (!tiktokSandbox()) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => ({}))) as { channel_id?: string; video_id?: string }
  if (!isUuid(body.channel_id)) return NextResponse.json({ error: 'channel' }, { status: 400 })
  const channel = await loadChannel(guard.ctx.workspace.id, body.channel_id)
  if (!channel || channel.type !== 'tiktok' || channel.external_id !== SANDBOX_ACCOUNT.openId) {
    return NextResponse.json({ error: 'channel' }, { status: 400 })
  }
  const video = SANDBOX_VIDEOS.find((v) => v.id === body.video_id) ?? SANDBOX_VIDEOS[0]
  const c = sandboxComment(round++)
  const outcome = await answerTiktokComment(channel, { commentId: c.commentId, videoId: video.id, authorId: c.authorId, authorName: c.authorName, text: c.text })
  return NextResponse.json({ outcome, comment: { author: c.authorName, text: c.text, video: video.text } })
}
