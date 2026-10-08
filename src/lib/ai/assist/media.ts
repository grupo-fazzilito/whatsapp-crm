import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { defaultChannel, loadChannel } from '@/lib/channels/store'
import { fetchChannelMediaBytes } from '@/lib/messaging/media'
import { safeFetch } from '@/lib/real-estate/portals/net'
import { MAX_MEDIA_BYTES } from '@/lib/ai/llm'
import { classifyMediaUrl } from './core'
import { resolveMime } from './mime'

export class MediaFetchError extends Error {
  constructor(
    public code: 'unsupported_url' | 'not_found' | 'too_large' | 'failed',
    message?: string,
  ) {
    super(message ?? code)
  }
}

export interface FetchedMedia {
  bytes: Uint8Array
  mimeType: string
}

/**
 * Downloads the bytes behind a message's media_url, server-side:
 *   /api/media/{channelId}/{mediaId}  → WhatsApp Cloud API with the channel token
 *   /api/whatsapp/media/{mediaId}      → legacy: workspace's default WhatsApp channel
 *   signed `attachments` storage URL   → storage download (own workspace only)
 *   https://…                          → public fetch with SSRF protection
 * Max MAX_MEDIA_BYTES (20 MB).
 */
export async function fetchMessageMedia(workspaceId: string, mediaUrl: string): Promise<FetchedMedia> {
  const ref = classifyMediaUrl(mediaUrl)
  if (!ref) throw new MediaFetchError('unsupported_url')
  try {
    if (ref.kind === 'wa_proxy' || ref.kind === 'wa_legacy') {
      const channel = ref.kind === 'wa_proxy' ? await loadChannel(workspaceId, ref.channelId) : await defaultChannel(workspaceId, 'whatsapp')
      if (!channel) throw new MediaFetchError('not_found', 'channel not found')
      const { bytes, contentType } = await fetchChannelMediaBytes(channel, ref.mediaId, MAX_MEDIA_BYTES)
      return { bytes, mimeType: resolveMime(contentType, bytes) }
    }
    if (ref.kind === 'attachment') {
      if (!ref.path.startsWith(`${workspaceId}/`)) throw new MediaFetchError('not_found', 'foreign object')
      const { data, error } = await supabaseAdmin().storage.from('attachments').download(ref.path)
      if (error || !data) throw new MediaFetchError('not_found', error?.message)
      if (data.size > MAX_MEDIA_BYTES) throw new MediaFetchError('too_large')
      const bytes = new Uint8Array(await data.arrayBuffer())
      return { bytes, mimeType: resolveMime(data.type, bytes) }
    }
    const got = await safeFetch(ref.url, { maxBytes: MAX_MEDIA_BYTES, timeoutMs: 15_000 })
    return { bytes: got.bytes, mimeType: resolveMime(got.contentType, got.bytes) }
  } catch (err) {
    if (err instanceof MediaFetchError) throw err
    const code = (err as { code?: string })?.code
    if (code === 'too_large' || /too large/i.test(String((err as Error)?.message))) throw new MediaFetchError('too_large')
    throw new MediaFetchError('failed', err instanceof Error ? err.message : String(err))
  }
}
