import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { loadChannel } from '@/lib/channels/store'
import { proxyChannelMedia } from '@/lib/messaging/media'

/**
 * GET /api/media/{channelId}/{mediaId}
 *
 * Inbound media proxy: provider media ids need the channel's token, so
 * the browser fetches them through here (members of the channel's
 * workspace only).
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ channelId: string; mediaId: string }> }
) {
  const { channelId, mediaId } = await params
  if (!channelId || !mediaId) {
    return NextResponse.json({ error: 'channelId and mediaId are required' }, { status: 400 })
  }

  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response

  const channel = await loadChannel(guard.ctx.workspace.id, channelId)
  return proxyChannelMedia(channel, mediaId)
}
