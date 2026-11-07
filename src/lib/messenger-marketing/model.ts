// Marketing messages on Messenger: rules shared by the server and the UI. Pure.
// https://developers.facebook.com/documentation/business-messaging/messenger-platform/marketing-messages-on-messenger

/** Meta allows one marketing message every 12 h per subscriber. */
export const MIN_GAP_MS = 12 * 3_600_000

export interface MessengerCard {
  title: string
  subtitle: string
  image_url: string
  button_text: string
  button_url: string
}

export const CARD_LIMITS = { title: 80, subtitle: 80, button: 20 }

export type CardIssue = 'title' | 'image' | 'button_text' | 'button_url' | 'subtitle'

export function parseCard(raw: unknown): MessengerCard | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!r) return null
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return { title: s(r.title), subtitle: s(r.subtitle), image_url: s(r.image_url), button_text: s(r.button_text), button_url: s(r.button_url) }
}

export function cardIssues(c: MessengerCard): CardIssue[] {
  const out: CardIssue[] = []
  if (!c.title || c.title.length > CARD_LIMITS.title) out.push('title')
  if (c.subtitle.length > CARD_LIMITS.subtitle) out.push('subtitle')
  if (!/^https:\/\/\S+$/.test(c.image_url)) out.push('image')
  if (!c.button_text || c.button_text.length > CARD_LIMITS.button) out.push('button_text')
  if (!/^https?:\/\/\S+$/.test(c.button_url) || c.button_url.length > 1000) out.push('button_url')
  return out
}

/** The card as Meta's generic template (the "message" of the send call). */
export function cardAttachment(c: MessengerCard) {
  return {
    attachment: {
      type: 'template',
      payload: {
        template_type: 'generic',
        elements: [
          {
            title: c.title,
            image_url: c.image_url,
            ...(c.subtitle ? { subtitle: c.subtitle } : {}),
            default_action: { type: 'web_url', url: c.button_url, webview_height_ratio: 'FULL' },
            buttons: [{ type: 'web_url', url: c.button_url, title: c.button_text }],
          },
        ],
      },
    },
  }
}

// ------------------------------------------------------------------
// Settings of the workspace (workspaces.settings.messenger_marketing)
// ------------------------------------------------------------------
export interface MessengerMarketingSettings {
  /** Ask new Messenger customers (first message) whether they want offers. */
  auto_invite: boolean
  /** Title of the opt-in request ("Get our offers"). */
  invite_title: string
  /** Image of the opt-in request (optional, https). */
  invite_image_url: string | null
}

export function defaultInviteTitle(locale: string): string {
  return locale === 'en' ? 'Get our offers and news' : 'Recibe nuestras ofertas y novedades'
}

export function normalizeMessengerSettings(raw: unknown, locale: string): MessengerMarketingSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const title = typeof s.invite_title === 'string' ? s.invite_title.trim().slice(0, 65) : ''
  const image = typeof s.invite_image_url === 'string' && /^https:\/\/\S+$/.test(s.invite_image_url) ? s.invite_image_url.slice(0, 1000) : null
  return { auto_invite: s.auto_invite === true, invite_title: title || defaultInviteTitle(locale), invite_image_url: image }
}

// ------------------------------------------------------------------
// messaging_optins webhook
// ------------------------------------------------------------------
export interface OptinEvent {
  pageId: string
  psid: string
  token: string | null
  /** subscribed (opt-in / re-opt-in / resumed) | stopped (they turned offers off) */
  status: 'subscribed' | 'stopped'
  expiresAt: Date | null
  timestamp: number
}

interface RawOptin {
  sender?: { id?: string }
  recipient?: { id?: string }
  timestamp?: number
  optin?: {
    type?: string
    notification_messages_token?: string
    notification_messages_status?: string
    token_expiry_timestamp?: number
    user_token_status?: string
  }
}

/** Messenger webhook body → the marketing opt-in events in it. */
export function parseOptins(body: unknown): OptinEvent[] {
  const b = body as { object?: string; entry?: { id?: string; messaging?: RawOptin[] }[] }
  if (b?.object !== 'page') return []
  const out: OptinEvent[] = []
  for (const entry of b.entry ?? []) {
    for (const ev of entry.messaging ?? []) {
      const o = ev.optin
      if (!o || o.type !== 'notification_messages' || !ev.sender?.id) continue
      const stopped = o.notification_messages_status === 'STOP_NOTIFICATIONS'
      const exp = typeof o.token_expiry_timestamp === 'number' ? new Date(o.token_expiry_timestamp * (o.token_expiry_timestamp < 1e12 ? 1000 : 1)) : null
      out.push({
        pageId: entry.id ?? ev.recipient?.id ?? '',
        psid: ev.sender.id,
        token: o.notification_messages_token ?? null,
        status: stopped ? 'stopped' : 'subscribed',
        expiresAt: exp,
        timestamp: ev.timestamp ?? Date.now(),
      })
    }
  }
  return out
}
