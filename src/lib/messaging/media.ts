import 'server-only'
import { NextResponse } from 'next/server'
import { getMediaUrl, downloadMedia } from '@/lib/whatsapp/meta-api'
import type { LoadedChannel } from '@/lib/channels'

/** Raw bytes of a WhatsApp media id (server-side use, e.g. AI transcription). */
export async function fetchChannelMediaBytes(
  channel: LoadedChannel,
  mediaId: string,
  maxBytes: number,
): Promise<{ bytes: Uint8Array; contentType: string }> {
  if (channel.type !== 'whatsapp') throw new Error('Media download not supported for this channel')
  const accessToken = channel.secrets.access_token
  if (!accessToken) throw new Error('WhatsApp not configured')
  const mediaInfo = await getMediaUrl({ mediaId, accessToken })
  const { buffer, contentType } = await downloadMedia({ downloadUrl: mediaInfo.url, accessToken })
  if (buffer.byteLength > maxBytes) throw new Error('Media too large')
  return { bytes: new Uint8Array(buffer), contentType: mediaInfo.mimeType || contentType }
}

/**
 * Streams a provider media object (inbound attachment) to the browser
 * using the channel's credentials. Only WhatsApp media ids need this;
 * other channels deliver public URLs.
 */
export async function proxyChannelMedia(channel: LoadedChannel | null, mediaId: string): Promise<Response> {
  if (!channel) {
    return NextResponse.json({ error: 'Channel not found' }, { status: 404 })
  }
  if (channel.type !== 'whatsapp') {
    return NextResponse.json({ error: 'Media proxy not supported for this channel' }, { status: 400 })
  }
  const accessToken = channel.secrets.access_token
  if (!accessToken) {
    return NextResponse.json({ error: 'WhatsApp not configured' }, { status: 400 })
  }

  try {
    const mediaInfo = await getMediaUrl({ mediaId, accessToken })
    const { buffer, contentType } = await downloadMedia({ downloadUrl: mediaInfo.url, accessToken })
    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType || mediaInfo.mimeType || 'application/octet-stream',
        // Authenticated, per-workspace content: never cache in shared caches.
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (error) {
    console.error('[media] proxy failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Failed to fetch media' }, { status: 502 })
  }
}
