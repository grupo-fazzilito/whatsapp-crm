// WhatsApp Calling API, inbound calls answered by a person in the browser.
// Pure: webhook parsing, statuses, call settings payload.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/user-initiated-calls
// https://developers.facebook.com/documentation/business-messaging/whatsapp/calling/call-settings

import { normalizePhone } from '@/lib/whatsapp/phone-utils'

export const CALL_STATUSES = ['ringing', 'answering', 'in_progress', 'completed', 'missed', 'rejected', 'failed'] as const
export type CallStatus = (typeof CALL_STATUSES)[number]

/** Still going: someone may answer, is connecting, or is talking. */
export const LIVE_STATUSES: CallStatus[] = ['ringing', 'answering', 'in_progress']

export function isLive(status: string): boolean {
  return (LIVE_STATUSES as string[]).includes(status)
}

export type CallEvent =
  | {
      kind: 'connect'
      phoneNumberId: string
      callId: string
      /** Caller's phone digits, when Meta shares it. */
      phone: string | null
      /** Caller's business-scoped user id. */
      userId: string | null
      name: string | null
      sdp: string
      timestamp: number
    }
  | {
      kind: 'terminate'
      phoneNumberId: string
      callId: string
      /** COMPLETED also for unanswered calls; those come without duration. */
      status: 'COMPLETED' | 'FAILED' | string
      durationSeconds: number | null
      answered: boolean
      error: string | null
      timestamp: number
    }

interface WaCall {
  id?: string
  from?: string
  from_user_id?: string
  event?: string
  direction?: string
  timestamp?: string
  session?: { sdp_type?: string; sdp?: string }
  status?: string
  start_time?: string
  duration?: number
  errors?: { message?: string; title?: string; code?: number }[]
}

export interface CallWebhookBody {
  object?: string
  entry?: {
    changes?: {
      field?: string
      value?: {
        metadata?: { phone_number_id?: string }
        contacts?: { profile?: { name?: string }; wa_id?: string; user_id?: string }[]
        calls?: WaCall[]
      }
    }[]
  }[]
}

/** `calls` webhook field → connect / terminate of calls customers made to the business. */
export function parseCallWebhook(body: CallWebhookBody): CallEvent[] {
  const out: CallEvent[] = []
  if (body.object !== 'whatsapp_business_account') return out
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'calls') continue
      const phoneNumberId = change.value?.metadata?.phone_number_id
      if (!phoneNumberId) continue
      for (const c of change.value?.calls ?? []) {
        if (!c.id || (c.direction && c.direction !== 'USER_INITIATED')) continue
        const timestamp = (parseInt(c.timestamp ?? '', 10) || Math.floor(Date.now() / 1000)) * 1000
        if (c.event === 'connect') {
          const sdp = c.session?.sdp
          if (!sdp) continue
          const phone = normalizePhone(c.from ?? '') || null
          const contact = change.value?.contacts?.find((k) => (phone && k.wa_id === c.from) || (c.from_user_id && k.user_id === c.from_user_id)) ?? change.value?.contacts?.[0]
          const userId = c.from_user_id || contact?.user_id || null
          if (!phone && !userId) continue
          out.push({ kind: 'connect', phoneNumberId, callId: c.id, phone, userId, name: contact?.profile?.name ?? null, sdp, timestamp })
        } else if (c.event === 'terminate') {
          const err = c.errors?.[0]
          out.push({
            kind: 'terminate',
            phoneNumberId,
            callId: c.id,
            status: c.status ?? 'COMPLETED',
            durationSeconds: typeof c.duration === 'number' ? c.duration : null,
            answered: !!c.start_time || typeof c.duration === 'number',
            error: err ? err.message ?? err.title ?? `Error ${err.code ?? ''}`.trim() : null,
            timestamp,
          })
        }
      }
    }
  }
  return out
}

/**
 * How a terminate webhook closes our row: talked → completed; we said no →
 * stays rejected; otherwise nobody picked up → missed (or failed on error).
 */
export function finalStatus(current: string, ev: Extract<CallEvent, { kind: 'terminate' }>): CallStatus {
  if (current === 'rejected') return 'rejected'
  if (ev.answered || current === 'in_progress') return 'completed'
  if (ev.status === 'FAILED' && ev.error) return 'failed'
  return 'missed'
}

/** "2:05" */
export function formatDuration(seconds: number | null | undefined): string {
  const s = Math.max(0, Math.round(seconds ?? 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------- settings

export interface BusinessHoursRow {
  day_name: string
  opening_time: string | null
  closing_time: string | null
  is_closed: boolean | null
  break_start: string | null
  break_end: string | null
}

const DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const
const hhmm = (v: string | null) => (v && /^\d{1,2}:\d{2}/.test(v) ? v.slice(0, 5).padStart(5, '0').replace(':', '') : null)

/** Business hours → Meta's weekly_operating_hours (a lunch break splits the day in two). */
export function weeklyHours(rows: BusinessHoursRow[]): { day_of_week: string; open_time: string; close_time: string }[] {
  const out: { day_of_week: string; open_time: string; close_time: string }[] = []
  for (const day of DAYS) {
    const r = rows.find((x) => x.day_name.toUpperCase() === day)
    if (!r || r.is_closed) continue
    const open = hhmm(r.opening_time)
    const close = hhmm(r.closing_time)
    if (!open || !close || open >= close) continue
    const bs = hhmm(r.break_start)
    const be = hhmm(r.break_end)
    if (bs && be && open < bs && bs < be && be < close) {
      out.push({ day_of_week: day, open_time: open, close_time: bs }, { day_of_week: day, open_time: be, close_time: close })
    } else {
      out.push({ day_of_week: day, open_time: open, close_time: close })
    }
  }
  return out
}

/** Body of POST /{phone-number-id}/settings. Callbacks stay off: phase 1 only takes calls. */
export function callingSettingsBody(opts: { enabled: boolean; hours?: { timezone: string; rows: BusinessHoursRow[] } | null }) {
  const calling: Record<string, unknown> = {
    status: opts.enabled ? 'ENABLED' : 'DISABLED',
    call_icon_visibility: 'DEFAULT',
    callback_permission_status: 'DISABLED',
  }
  const week = opts.hours ? weeklyHours(opts.hours.rows) : []
  calling.call_hours =
    opts.enabled && opts.hours && week.length
      ? { status: 'ENABLED', timezone_id: opts.hours.timezone, weekly_operating_hours: week }
      : { status: 'DISABLED' }
  return { calling }
}

/** Meta needs a daily limit of 2,000+ unique recipients to allow calling. */
export function tierAllowsCalling(tier: string | null | undefined): boolean | null {
  if (!tier) return null
  const t = tier.toUpperCase()
  if (t === 'TIER_UNLIMITED') return true
  const m = t.match(/^TIER_(\d+)(K?)$/)
  if (!m) return null
  return Number(m[1]) * (m[2] ? 1000 : 1) >= 2000
}

/** What channels.settings.calling holds. */
export interface CallingState {
  enabled: boolean
  use_business_hours: boolean
  tier: string | null
  error: string | null
  updated_at: string
}

export function readCallingState(settings: Record<string, unknown> | null | undefined): CallingState | null {
  const v = settings?.calling as Partial<CallingState> | undefined
  if (!v || typeof v !== 'object' || typeof v.enabled !== 'boolean') return null
  return {
    enabled: v.enabled,
    use_business_hours: !!v.use_business_hours,
    tier: typeof v.tier === 'string' ? v.tier : null,
    error: typeof v.error === 'string' ? v.error : null,
    updated_at: typeof v.updated_at === 'string' ? v.updated_at : '',
  }
}
