import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { defaultChannel } from '@/lib/channels/store'
import { proxyChannelMedia } from '@/lib/messaging/media'

/**
 * Legacy media proxy (URLs stored on messages received before channels
 * existed). Uses the workspace's default WhatsApp channel; new messages
 * use /api/media/{channelId}/{mediaId}.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ mediaId: string }> }
) {
  const { mediaId } = await params

  if (!mediaId) {
    return NextResponse.json(
      { error: 'Media ID is required' },
      { status: 400 }
    )
  }

  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response

  const channel = await defaultChannel(guard.ctx.workspace.id, 'whatsapp')
  return proxyChannelMedia(channel, mediaId)
}
