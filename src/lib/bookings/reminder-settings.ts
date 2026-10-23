// Booking reminder settings (workspaces.settings.booking_reminders) and the
// reminder texts. Pure — safe on the client (Automations → Reminders) and in
// the reminders cron.

import type { ReminderKind } from './reminders'

export const REMINDER_KINDS: ReminderKind[] = ['24h', '4h', '2h']

export interface ReminderSettings {
  /** Reminders turned off. */
  off: ReminderKind[]
  /** Custom texts (placeholders below); empty = the default text. */
  texts: Partial<Record<ReminderKind, string>>
}

/** Placeholders the custom texts may use. */
export const REMINDER_PLACEHOLDERS = ['nombre', 'cita', 'servicio', 'profesional', 'fecha', 'hora', 'negocio'] as const
export type ReminderPlaceholder = (typeof REMINDER_PLACEHOLDERS)[number]

export const REMINDER_TEXT_MAX = 900

export function reminderSettings(settings: unknown): ReminderSettings {
  const raw = (settings && typeof settings === 'object' ? (settings as Record<string, unknown>).booking_reminders : null) as Record<string, unknown> | null
  const off = Array.isArray(raw?.off) ? (raw!.off as unknown[]).filter((k): k is ReminderKind => REMINDER_KINDS.includes(k as ReminderKind)) : []
  const texts: Partial<Record<ReminderKind, string>> = {}
  const rawTexts = raw?.texts && typeof raw.texts === 'object' ? (raw.texts as Record<string, unknown>) : {}
  for (const k of REMINDER_KINDS) {
    const v = rawTexts[k]
    if (typeof v === 'string' && v.trim()) texts[k] = v.trim().slice(0, REMINDER_TEXT_MAX)
  }
  return { off: [...new Set(off)], texts }
}

/** Validates a settings patch from the Reminders screen; throws on bad input. */
export function parseReminderSettings(input: unknown): ReminderSettings {
  if (!input || typeof input !== 'object') throw new Error('booking_reminders must be an object')
  const parsed = reminderSettings({ booking_reminders: input })
  for (const k of REMINDER_KINDS) {
    const raw = ((input as Record<string, unknown>).texts as Record<string, unknown> | undefined)?.[k]
    if (typeof raw === 'string' && raw.trim().length > REMINDER_TEXT_MAX) throw new Error(`texts.${k} is too long`)
  }
  return parsed
}

/** Fills {nombre} {cita}… in a custom text; unknown braces are left as typed. */
export function fillReminderText(text: string, values: Record<ReminderPlaceholder, string>): string {
  return text
    .replace(/\{(\w+)\}/g, (m, k: string) => ((REMINDER_PLACEHOLDERS as readonly string[]).includes(k) ? values[k as ReminderPlaceholder] : m))
    .replace(/[ \t]+([,.!?])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

/** Reply ids of the reminder buttons (text and template): rem:<action>:<bookingId>. */
export const REMINDER_PREFIX = 'rem:'
export type ReminderAction = 'confirm' | 'change'

export function reminderReplyId(action: ReminderAction, bookingId: string): string {
  return `${REMINDER_PREFIX}${action}:${bookingId}`
}

export function parseReminderReply(id: string | null | undefined): { action: ReminderAction; bookingId: string } | null {
  if (!id?.startsWith(REMINDER_PREFIX)) return null
  const [, action, bookingId] = id.split(':')
  if ((action !== 'confirm' && action !== 'change') || !/^[0-9a-f-]{36}$/i.test(bookingId ?? '')) return null
  return { action, bookingId }
}
