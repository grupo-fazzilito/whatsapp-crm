// Validation of Google Calendar push notifications (pure).
// https://developers.google.com/workspace/calendar/api/guides/push

import { safeEqual } from './state'

export interface NotificationHeaders {
  channelId: string | null
  channelToken: string | null
  resourceId: string | null
  resourceState: string | null
}

export function readNotificationHeaders(h: Headers): NotificationHeaders {
  return {
    channelId: h.get('x-goog-channel-id'),
    channelToken: h.get('x-goog-channel-token'),
    resourceId: h.get('x-goog-resource-id'),
    resourceState: h.get('x-goog-resource-state'),
  }
}

export interface StoredChannel {
  watch_channel_id: string | null
  watch_resource_id: string | null
  watch_token: string | null
}

export type NotificationCheck =
  | { ok: true; action: 'ignore' | 'sync' }
  | { ok: false; status: 400 | 403 | 404 }

/**
 * Decides what to do with a notification for a stored channel. The
 * channel token is a per-channel random secret, compared in constant
 * time; the resource id must match the one returned by events.watch.
 */
export function checkNotification(h: NotificationHeaders, stored: StoredChannel | null): NotificationCheck {
  if (!h.channelId || !h.resourceState) return { ok: false, status: 400 }
  if (!stored || stored.watch_channel_id !== h.channelId) return { ok: false, status: 404 }
  if (!stored.watch_token || !safeEqual(h.channelToken, stored.watch_token)) return { ok: false, status: 403 }
  if (stored.watch_resource_id && h.resourceId !== stored.watch_resource_id) return { ok: false, status: 403 }
  // 'sync' only announces a new channel; 'exists' / 'not_exists' = changes.
  return { ok: true, action: h.resourceState === 'sync' ? 'ignore' : 'sync' }
}
