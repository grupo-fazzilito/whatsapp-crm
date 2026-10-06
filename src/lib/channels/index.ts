import { whatsappAdapter } from './adapters/whatsapp'
import { instagramAdapter, messengerAdapter } from './adapters/meta-messaging'
import { tiktokAdapter } from './adapters/tiktok'
import { webchatAdapter } from './adapters/webchat'
import type { ChannelAdapter, ChannelType } from './types'

export * from './types'

const ADAPTERS: Record<ChannelType, ChannelAdapter> = {
  whatsapp: whatsappAdapter,
  messenger: messengerAdapter,
  instagram: instagramAdapter,
  tiktok: tiktokAdapter,
  webchat: webchatAdapter,
}

export function getAdapter(type: ChannelType): ChannelAdapter {
  return ADAPTERS[type]
}
