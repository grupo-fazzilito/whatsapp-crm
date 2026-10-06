// Web chat has no external provider: the message row itself is the
// delivery. The widget reads new rows through /api/webchat/stream.
import type { ChannelAdapter } from '../types'

export const webchatAdapter: ChannelAdapter = {
  type: 'webchat',
  capabilities: { templates: false, reactions: false, interactive: true, replyWindowHours: null, media: true },
  async send() {
    return { externalId: null }
  },
}
