// Publicaciones: rules shared by the server and the UI. Pure.

import { zonedTimeToUtc } from '@/lib/bookings/reminders'
import { addDays, zonedNow } from '@/lib/ai/time'

export const TARGETS = ['facebook', 'instagram', 'whatsapp_status'] as const
export type Target = (typeof TARGETS)[number]
export const FORMATS = ['post', 'story', 'reel'] as const
export type PostFormat = (typeof FORMATS)[number]
export const POST_STATUSES = ['draft', 'pending_approval', 'scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled'] as const
export type PostStatus = (typeof POST_STATUSES)[number]
export type PostOrigin = 'manual' | 'new_product' | 'restock' | 'calendar'

export interface PostMedia {
  url: string
  type: 'image' | 'video'
}

/** Result per destination. `processing` = Instagram still preparing the video (finished on the next cron run). */
export interface TargetResult {
  status: 'published' | 'failed' | 'processing' | 'sent'
  id?: string | null
  url?: string | null
  error?: string | null
  container?: string | null
  at?: string
}

export const MAX_CAPTION = 2200
export const MAX_MEDIA = 10
/** Posts made automatically wait this long before going out (time to edit or cancel them). */
export const AUTO_DELAY_MINUTES = 30

export const isTarget = (v: unknown): v is Target => typeof v === 'string' && (TARGETS as readonly string[]).includes(v)
export const isFormat = (v: unknown): v is PostFormat => typeof v === 'string' && (FORMATS as readonly string[]).includes(v)

// ------------------------------------------------------------------
// Settings of the workspace (workspaces.settings.social)
// ------------------------------------------------------------------
export interface CalendarSlot {
  /** 0 = Sunday … 6 = Saturday */
  day: number
  /** HH:MM in the business's time zone */
  time: string
}

export interface SocialSettings {
  /** Posts made automatically (new product, restock, calendar): published at their time, or wait for approval. */
  approval: 'required' | 'auto'
  auto_new_product: boolean
  auto_restock: boolean
  auto_targets: Target[]
  auto_format: 'post' | 'story'
  calendar: { enabled: boolean; slots: CalendarSlot[]; targets: Target[]; format: 'post' | 'story' }
  /** Phones that get the WhatsApp status media (digits, with country code). */
  status_phones: string[]
  /** WhatsApp number that sends it (null = the first connected one). */
  status_channel_id: string | null
  /** Extra instructions for the captions the AI writes. */
  caption_instructions: string
}

export const DEFAULT_SOCIAL: SocialSettings = {
  approval: 'required',
  auto_new_product: false,
  auto_restock: false,
  auto_targets: ['facebook', 'instagram'],
  auto_format: 'post',
  calendar: { enabled: false, slots: [], targets: ['facebook', 'instagram'], format: 'post' },
  status_phones: [],
  status_channel_id: null,
  caption_instructions: '',
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const targetsOf = (v: unknown, fallback: Target[]): Target[] => (Array.isArray(v) ? [...new Set(v.filter(isTarget))] : fallback)

/** Phone as digits with country code (8–15 digits), or null. */
export function cleanPhone(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const d = v.replace(/\D/g, '')
  return d.length >= 8 && d.length <= 15 ? d : null
}

/** Stored (or posted) settings → valid settings (anything invalid falls back to the default). */
export function normalizeSocial(raw: unknown): SocialSettings {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const cal = (s.calendar && typeof s.calendar === 'object' ? s.calendar : {}) as Record<string, unknown>
  const slots = Array.isArray(cal.slots)
    ? (cal.slots as Record<string, unknown>[])
        .filter((x) => x && Number.isInteger(x.day) && (x.day as number) >= 0 && (x.day as number) <= 6 && typeof x.time === 'string' && TIME_RE.test(x.time))
        .map((x) => ({ day: x.day as number, time: x.time as string }))
    : []
  const uniqueSlots = [...new Map(slots.map((x) => [`${x.day}-${x.time}`, x])).values()].sort((a, b) => a.day - b.day || a.time.localeCompare(b.time)).slice(0, 28)
  return {
    approval: s.approval === 'auto' ? 'auto' : 'required',
    auto_new_product: s.auto_new_product === true,
    auto_restock: s.auto_restock === true,
    auto_targets: targetsOf(s.auto_targets, DEFAULT_SOCIAL.auto_targets),
    auto_format: s.auto_format === 'story' ? 'story' : 'post',
    calendar: {
      enabled: cal.enabled === true,
      slots: uniqueSlots,
      targets: targetsOf(cal.targets, DEFAULT_SOCIAL.calendar.targets),
      format: cal.format === 'story' ? 'story' : 'post',
    },
    status_phones: Array.isArray(s.status_phones) ? [...new Set(s.status_phones.map(cleanPhone).filter((p): p is string => !!p))].slice(0, 5) : [],
    status_channel_id: typeof s.status_channel_id === 'string' && UUID_RE.test(s.status_channel_id) ? s.status_channel_id : null,
    caption_instructions: typeof s.caption_instructions === 'string' ? s.caption_instructions.trim().slice(0, 500) : '',
  }
}

// ------------------------------------------------------------------
// A post from the editor
// ------------------------------------------------------------------
export interface PostInput {
  format: PostFormat
  caption: string
  media: PostMedia[]
  targets: Target[]
  product_id: string | null
  link_url: string | null
  /** null = publish now */
  scheduled_at: string | null
  /** true = keep it as a draft (not scheduled) */
  draft: boolean
}

export type PostIssue =
  | 'targets'
  | 'media_required'
  | 'too_many_media'
  | 'one_media'
  | 'video_required'
  | 'caption_too_long'
  | 'schedule_past'
  | 'schedule_far'
  | 'invalid'

const isMedia = (v: unknown): v is PostMedia => {
  const m = v as PostMedia
  return !!m && typeof m.url === 'string' && /^https?:\/\//.test(m.url) && m.url.length <= 2000 && (m.type === 'image' || m.type === 'video')
}

export function parsePostInput(raw: unknown): PostInput | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null
  if (!r || !isFormat(r.format) || !Array.isArray(r.media) || !Array.isArray(r.targets)) return null
  if (!r.media.every(isMedia) || !r.targets.every(isTarget)) return null
  if (r.caption !== undefined && typeof r.caption !== 'string') return null
  const productId = r.product_id == null || r.product_id === '' ? null : typeof r.product_id === 'string' && UUID_RE.test(r.product_id) ? r.product_id : undefined
  if (productId === undefined) return null
  const link = r.link_url == null || r.link_url === '' ? null : typeof r.link_url === 'string' && /^https?:\/\/\S+$/.test(r.link_url) && r.link_url.length <= 1000 ? r.link_url : undefined
  if (link === undefined) return null
  let scheduled: string | null = null
  if (r.scheduled_at != null && r.scheduled_at !== '') {
    const d = typeof r.scheduled_at === 'string' ? new Date(r.scheduled_at) : null
    if (!d || Number.isNaN(d.getTime())) return null
    scheduled = d.toISOString()
  }
  return {
    format: r.format,
    caption: typeof r.caption === 'string' ? r.caption.replace(/\r\n/g, '\n').trim() : '',
    media: (r.media as PostMedia[]).map((m) => ({ url: m.url, type: m.type })),
    targets: [...new Set(r.targets as Target[])],
    product_id: productId,
    link_url: link,
    scheduled_at: scheduled,
    draft: r.draft === true,
  }
}

/** What's wrong with the post for its format and destinations (empty = it can go out). */
export function postIssues(p: Pick<PostInput, 'format' | 'caption' | 'media' | 'targets' | 'scheduled_at' | 'draft'>, now = new Date()): PostIssue[] {
  const out: PostIssue[] = []
  if (!p.targets.length) out.push('targets')
  if (!p.media.length) out.push('media_required')
  if (p.media.length > MAX_MEDIA) out.push('too_many_media')
  if (p.format !== 'post' && p.media.length > 1) out.push('one_media')
  if (p.format === 'reel' && p.media.some((m) => m.type !== 'video')) out.push('video_required')
  if (p.caption.length > MAX_CAPTION) out.push('caption_too_long')
  if (p.scheduled_at && !p.draft) {
    const t = new Date(p.scheduled_at).getTime()
    if (t < now.getTime() - 5 * 60_000) out.push('schedule_past')
    if (t > now.getTime() + 366 * 86_400_000) out.push('schedule_far')
  }
  return out
}

/** Instagram takes no clickable links: the link moves to "link in bio". Facebook keeps it. */
export function captionFor(target: Target, caption: string, link: string | null): string {
  if (!link || caption.includes(link)) return caption
  if (target === 'instagram') return caption
  return caption ? `${caption}\n\n${link}` : link
}

/** Overall status from the result of each destination. */
export function overallStatus(targets: Target[], results: Partial<Record<Target, TargetResult>>): PostStatus {
  const states = targets.map((t) => results[t]?.status)
  if (states.some((s) => s === 'processing' || s === undefined)) return 'publishing'
  const ok = states.filter((s) => s === 'published' || s === 'sent').length
  if (ok === targets.length) return 'published'
  return ok ? 'partial' : 'failed'
}

// ------------------------------------------------------------------
// Weekly calendar
// ------------------------------------------------------------------
export interface DueSlot {
  /** "YYYY-MM-DDTHH:MM" local time: the post made for it is unique. */
  key: string
  at: Date
}

/** Calendar slots starting between now and now + `aheadHours`, in the business's time zone. */
export function upcomingSlots(slots: CalendarSlot[], timeZone: string, now: Date, aheadHours: number): DueSlot[] {
  const today = zonedNow(timeZone, now).date
  const out: DueSlot[] = []
  const days = Math.ceil(aheadHours / 24) + 1
  for (let i = 0; i <= days; i++) {
    const date = addDays(today, i)
    const [y, m, d] = date.split('-').map(Number)
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
    for (const s of slots) {
      if (s.day !== weekday) continue
      const at = zonedTimeToUtc(date, s.time, timeZone)
      const diff = at.getTime() - now.getTime()
      if (diff > 0 && diff <= aheadHours * 3_600_000) out.push({ key: `${date}T${s.time}`, at })
    }
  }
  return out.sort((a, b) => a.at.getTime() - b.at.getTime())
}
