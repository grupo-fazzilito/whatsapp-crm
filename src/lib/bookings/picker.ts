import 'server-only'
import { Prisma } from '@/generated/prisma/client'
import { tenantDb } from '@/lib/db/tenant'
import { sendMessage } from '@/lib/messaging/send'
import { createTranslator, type Translator } from '@/i18n/translate'
import { getPreset, industryLabel, resolveIndustry } from '@/lib/industries'
import { invalidateBusinessContext, loadBusinessContext, type BusinessContext } from '@/lib/ai/context'
import { scheduleBookingSync } from '@/lib/integrations/google/sync'
import { pushCancellations } from '@/lib/integrations/calendly/sync'
import { createBookingFromDraft } from '@/lib/ai/bookings'
import { longDate } from '@/lib/ai/engine'
import { freeSlotsForBusiness, freeSlotsForStaff, upcomingDates } from '@/lib/ai/slots'
import { zonedNow } from '@/lib/ai/time'
import { calendlySlotsForPrompt } from '@/lib/integrations/calendly/booking'
import { windowState } from '@/lib/automations/followup-rules'
import { onViewingConfirmed } from '@/lib/real-estate/leads/visits'
import type { ChannelType } from '@/lib/channels'
import {
  MAX_MISSES,
  MAX_ROWS,
  PICKER_DAYS,
  PICKER_TTL_MS,
  chosenOption,
  daysWithTimes,
  isPickerReply,
  parseFieldAnswer,
  pickerReplyId,
  row,
  shortDay,
  timePage,
  type PickerDraft,
  type PickerOption,
  type PickerOrigin,
  type PickerOutcome,
  type PickerState,
} from './picker-model'

// Booking picker: the customer books by tapping, without the AI (no
// credits). Started by a flow's "Book appointment" step or by a team member
// from the inbox ("Send schedule"). Calendly-linked services book in
// Calendly, the rest in Whasalia's own schedule (which syncs to the staff's
// Google Calendar) — the same createBookingFromDraft the AI uses.
//
// The choice in progress lives in conversations.booking_picker; each answer
// re-derives the next missing piece from the draft, so re-sending a step is
// always safe.

type Lang = 'es' | 'en'

interface Env {
  workspaceId: string
  conversationId: string
  contactId: string
  ctx: BusinessContext
  lang: Lang
  t: Translator
  contact: { name: string | null; email: string | null }
  /** Team member for the first message sent from the inbox. */
  senderUserId?: string | null
  /** False while the picker is being started by a flow step (the step itself continues the run). */
  resumeFlow: boolean
}

type StepResult = { status: 'waiting' } | { status: 'done'; outcome: PickerOutcome }

export interface StartPickerInput {
  workspaceId: string
  conversationId: string
  origin: PickerOrigin
  flow?: { run_id: string; node_key: string }
  userId?: string | null
  preset?: PickerDraft
}

export type StartPickerResult =
  | StepResult
  | { status: 'error'; reason: 'not_found' | 'window_closed' | 'bookings_off' | 'no_slots' }

/** Starts the picker in a conversation (sends the first step). */
export async function startBookingPicker(input: StartPickerInput): Promise<StartPickerResult> {
  const db = tenantDb(input.workspaceId)
  const conv = await db.conversations
    .findFirst({
      where: { id: input.conversationId },
      select: { id: true, contact_id: true, last_customer_message_at: true, channels: { select: { type: true } } },
    })
    .catch(() => null)
  if (!conv) return { status: 'error', reason: 'not_found' }
  if (input.origin === 'inbox' && !windowState((conv.channels?.type ?? 'whatsapp') as ChannelType, (conv.last_customer_message_at as string | null) ?? null).open) {
    return { status: 'error', reason: 'window_closed' }
  }
  const env = await loadEnv(input.workspaceId, conv.id, conv.contact_id, { senderUserId: input.userId ?? null, resumeFlow: false })
  if (!env) return { status: 'error', reason: 'not_found' }
  if (!resolveIndustry(env.ctx.workspace.industry, env.ctx.workspace.settings).modules.bookings) return { status: 'error', reason: 'bookings_off' }

  const state: PickerState = {
    step: 'day',
    options: [],
    draft: cleanDraft(input.preset ?? {}, env.ctx),
    origin: input.origin,
    ...(input.flow ? { flow: input.flow } : {}),
    started_by: input.userId ?? null,
    misses: 0,
    expires_at: new Date(Date.now() + PICKER_TTL_MS).toISOString(),
  }
  // From the inbox, tell the team member instead of sending "no free times" to the customer.
  if (input.origin === 'inbox' && !(await mayHaveTimes(env, state.draft))) return { status: 'error', reason: 'no_slots' }
  return advance(env, state)
}

/** False when the selection already fixed has no free time in the next days. */
async function mayHaveTimes(env: Env, d: PickerDraft): Promise<boolean> {
  const services = resolveIndustry(env.ctx.workspace.industry, env.ctx.workspace.settings).modules.services ? env.ctx.services : []
  if (services.length > 1 && !d.service_id) return true
  const draft = { ...d, service_id: d.service_id ?? services[0]?.id ?? null }
  return Object.keys(await timesByDate(env, draft, null)).length > 0
}

/**
 * An inbound message while a picker may be open. Returns true when the
 * picker took it (nobody else — flows, AI — should answer it).
 */
export async function handleBookingPickerInbound(input: {
  workspaceId: string
  conversationId: string
  contactId: string
  state: unknown
  replyId: string | null
  text: string
}): Promise<boolean> {
  const tapped = isPickerReply(input.replyId)
  const state = liveState(input.state)
  if (!state) {
    if (!tapped) return false
    // A list from a picker that already ended.
    if (input.state) await saveState(input.workspaceId, input.conversationId, null)
    const env = await loadEnv(input.workspaceId, input.conversationId, input.contactId, { resumeFlow: true })
    if (env) await say(env, env.t('bookings.picker.expired'))
    return true
  }
  const env = await loadEnv(input.workspaceId, input.conversationId, input.contactId, { resumeFlow: true })
  if (!env) return false

  if (state.step === 'field') {
    if (tapped) {
      await advance(env, state)
      return true
    }
    const field = fieldsToAsk(env, state.draft).find((f) => f.key === state.field)
    if (!field) {
      await advance(env, state)
      return true
    }
    const value = parseFieldAnswer(field, input.text)
    if (value === null) {
      if (state.origin === 'inbox' && state.misses >= MAX_MISSES) return false
      state.misses += 1
      await askField(env, state, field, env.t('bookings.picker.invalidField'))
      return true
    }
    state.draft = setField(state.draft, field.key, value)
    state.misses = 0
    await advance(env, state)
    return true
  }

  const chosen = chosenOption(state, { replyId: input.replyId, text: input.text })
  if (!chosen) {
    // A team member's picker: a question or anything else goes to the
    // conversation as usual; the open list still works when tapped.
    if (state.origin === 'inbox' && !tapped) return false
    state.misses += 1
    if (state.origin === 'flow' && state.misses > MAX_MISSES) {
      await finish(env, state, 'not_booked', env.t('bookings.picker.gaveUp'))
      return true
    }
    await advance(env, state, env.t('bookings.picker.didntGet'))
    return true
  }
  state.misses = 0
  if (state.step === 'time' && chosen.id.startsWith('more:')) {
    state.offset = Number(chosen.id.slice(5)) || 0
    await advance(env, state)
    return true
  }
  const key = ({ product: 'product_id', service: 'service_id', staff: 'staff_id', day: 'date', time: 'time' } as const)[state.step]
  state.draft = { ...state.draft, [key]: chosen.id }
  if (state.step === 'day') {
    state.draft.time = null
    state.offset = 0
  }
  await advance(env, state)
  return true
}

// ------------------------------------------------------------
// Steps
// ------------------------------------------------------------

async function advance(env: Env, state: PickerState, lead?: string, depth = 0): Promise<StepResult> {
  const { ctx, t } = env
  // A day listed as free can turn out full (Calendly answers per range): don't bounce forever.
  if (depth > 2) return finish(env, state, 'not_booked', t('bookings.picker.noSlots'))
  const preset = getPreset(ctx.workspace.industry)
  const { modules } = resolveIndustry(ctx.workspace.industry, ctx.workspace.settings)
  const d = state.draft
  const label = (k: 'service' | 'staff' | 'product' | 'booking') => industryLabel(ctx.workspace.industry, k, env.lang, ctx.workspace.settings).toLowerCase()

  // 1) What is booked: listing (real estate), service, staff member.
  if (preset.bookingFields.some((f) => f.type === 'product' && f.required) && !d.product_id) {
    const products = await tenantDb(env.workspaceId)
      .products.findMany({ select: { id: true, name: true }, where: { is_active: true }, orderBy: [{ is_featured: 'desc' }, { updated_at: 'desc' }], take: MAX_ROWS })
      .catch(() => [])
    if (!products.length) return finish(env, state, 'not_booked', t('bookings.picker.noSlots'))
    return ask(env, state, 'product', t('bookings.picker.chooseOne', { what: label('product') }), products.map((p) => row(p.id, p.name)), lead)
  }
  const services = modules.services ? ctx.services : []
  if (services.length && !d.service_id) {
    if (services.length === 1) d.service_id = services[0].id
    else return ask(env, state, 'service', t('bookings.picker.chooseOne', { what: label('service') }), services.slice(0, MAX_ROWS).map((s) => row(s.id, s.name, s.duration_minutes ? t('bookings.minutes', { n: s.duration_minutes }) : null)), lead)
  }
  const service = services.find((s) => s.id === d.service_id)
  const link = service ? ctx.calendly?.[service.id] : undefined
  if (!link && preset.bookingNeedsStaff && !d.staff_id) {
    const pool = staffPool(ctx, d)
    if (pool.length === 1) d.staff_id = pool[0].id
    else if (pool.length > 1) return ask(env, state, 'staff', t('bookings.picker.chooseStaff', { booking: label('booking') }), pool.slice(0, MAX_ROWS).map((s) => row(s.id, s.name, s.title)), lead)
  }

  // 2) When.
  if (!d.date) {
    const byDate = await timesByDate(env, d, null)
    const days = daysWithTimes(byDate, upcomingDates(zonedNow(ctx.timeZone).date, PICKER_DAYS))
    if (!days.length) return finish(env, state, 'not_booked', t('bookings.picker.noSlots'))
    const options = days.map((x) => row(x.date, shortDay(x.date, env.lang), x.count === 1 ? t('bookings.picker.oneTime') : t('bookings.picker.times', { n: x.count })))
    return ask(env, state, 'day', t('bookings.picker.chooseDay', { what: service?.name ?? label('booking') }), options, lead)
  }
  if (!d.time) {
    const times = (await timesByDate(env, d, d.date))[d.date] ?? []
    if (!times.length) {
      state.draft = { ...d, date: null }
      return advance(env, state, t('bookings.picker.dayFull'), depth + 1)
    }
    const page = timePage(times, state.offset ?? 0)
    const options: PickerOption[] = page.times.map((x) => row(x, x))
    if (page.nextOffset !== null) options.push(row(`more:${page.nextOffset}`, t('bookings.picker.moreTimes')))
    return ask(env, state, 'time', t('bookings.picker.chooseTime', { date: longDate(d.date, env.lang, ctx) }), options, lead)
  }

  // 3) The details the business asks for.
  const field = fieldsToAsk(env, d)[0]
  if (field) return askField(env, state, field, lead)

  return book(env, state)
}

async function book(env: Env, state: PickerState): Promise<StepResult> {
  const { t, ctx } = env
  const d = state.draft
  const { replaces, ...draft } = d
  const result = await createBookingFromDraft({
    workspaceId: env.workspaceId,
    contactId: env.contactId,
    conversationId: env.conversationId,
    aiAgentId: null,
    draft: { ...draft, customer_name: d.customer_name ?? env.contact.name },
    source: state.origin === 'flow' ? 'flow' : 'picker',
  })
  if (result.ok) {
    if (replaces) await cancelReplaced(env, replaces)
    if (d.product_id) await onViewingConfirmed(env.workspaceId, result.bookingId, { sendLocation: true }).catch(() => undefined)
    const what = result.serviceName ?? industryLabel(ctx.workspace.industry, 'booking', env.lang, ctx.workspace.settings).toLowerCase()
    const text = t(replaces ? 'bookings.picker.rebooked' : 'bookings.picker.booked', {
      what,
      date: longDate(d.date!, env.lang, ctx),
      time: d.time!,
      staff: result.staffName ? t('bookings.picker.withStaff', { name: result.staffName }) : '',
    })
    return finish(env, state, 'booked', text, { booking_id: result.bookingId })
  }
  switch (result.reason) {
    case 'link':
      return finish(env, state, 'link', t('bookings.picker.link', { url: result.url }))
    case 'missing': {
      // Calendly needs the email; anything else the preset requires is asked too.
      if (result.missing.includes('email')) state.draft = { ...d, fields: { ...d.fields, email: null } }
      const next = fieldsToAsk(env, state.draft, result.missing)[0]
      if (next) return askField(env, state, next)
      return finish(env, state, 'not_booked', t('bookings.picker.failed'))
    }
    case 'slot_taken':
      state.draft = { ...d, time: null }
      state.offset = 0
      return advance(env, state, t('bookings.picker.slotTaken'))
    case 'closed':
    case 'past':
      state.draft = { ...d, date: null, time: null }
      return advance(env, state, t('bookings.picker.dayFull'))
    default:
      console.error('[picker] booking failed:', result.detail)
      return finish(env, state, 'not_booked', t('bookings.picker.failed'))
  }
}

/** The booking the customer asked to change (from a reminder): cancelled here, in Google Calendar and in Calendly. */
async function cancelReplaced(env: Env, bookingId: string) {
  const { count } = await tenantDb(env.workspaceId)
    .bookings.updateMany({ where: { id: bookingId, contact_id: env.contactId, status: { in: ['pending', 'confirmed'] } }, data: { status: 'cancelled', updated_at: new Date() } })
    .catch(() => ({ count: 0 }))
  if (!count) return
  invalidateBusinessContext(env.workspaceId)
  scheduleBookingSync(bookingId, env.workspaceId)
  void pushCancellations(env.workspaceId).catch(() => undefined)
}

async function ask(env: Env, state: PickerState, step: PickerState['step'], text: string, options: PickerOption[], lead?: string): Promise<StepResult> {
  state.step = step
  state.field = undefined
  state.options = options
  await saveState(env.workspaceId, env.conversationId, state)
  await send(env, {
    type: 'list',
    text: lead ? `${lead}\n\n${text}` : text,
    buttonLabel: env.t('bookings.picker.listButton'),
    sections: [{ options: options.map((o) => ({ id: pickerReplyId(step, o.id), title: o.title, description: o.description })) }],
  })
  return { status: 'waiting' }
}

async function askField(env: Env, state: PickerState, field: AskField, lead?: string): Promise<StepResult> {
  state.step = 'field'
  state.field = field.key
  state.options = []
  await saveState(env.workspaceId, env.conversationId, state)
  const text = env.t('bookings.picker.askField', { label: field.label })
  await say(env, lead ? `${lead}\n\n${text}` : text)
  return { status: 'waiting' }
}

async function finish(env: Env, state: PickerState, outcome: PickerOutcome, text: string, metadata: Record<string, unknown> = {}): Promise<StepResult> {
  await saveState(env.workspaceId, env.conversationId, null)
  await say(env, text, { event: `booking_picker_${outcome}`, ...metadata })
  if (state.flow && env.resumeFlow) {
    const { resumeRunAfterBooking } = await import('@/lib/flows/engine')
    await resumeRunAfterBooking(env.workspaceId, state.flow.run_id, state.flow.node_key, outcome).catch((err) =>
      console.error('[picker] flow resume failed:', err instanceof Error ? err.message : err),
    )
  }
  return { status: 'done', outcome }
}

// ------------------------------------------------------------
// Availability
// ------------------------------------------------------------

function staffPool(ctx: BusinessContext, d: PickerDraft) {
  const { modules } = resolveIndustry(ctx.workspace.industry, ctx.workspace.settings)
  if (!modules.staff) return []
  return ctx.staff.filter((s) => (!d.staff_id || s.id === d.staff_id) && (!d.service_id || s.service_ids.length === 0 || s.service_ids.includes(d.service_id)))
}

/** Free start times per date: Calendly's for linked services, Whasalia's (with Google busy time) otherwise. */
async function timesByDate(env: Env, d: PickerDraft, date: string | null): Promise<Record<string, string[]>> {
  const { ctx } = env
  const link = d.service_id ? ctx.calendly?.[d.service_id] : undefined
  if (link) {
    try {
      return await calendlySlotsForPrompt(link, ctx.timeZone, date, PICKER_DAYS)
    } catch (err) {
      console.warn('[picker] calendly availability unavailable:', err instanceof Error ? err.message : err)
      return {}
    }
  }
  const service = ctx.services.find((s) => s.id === d.service_id)
  const now = zonedNow(ctx.timeZone)
  const q = {
    hours: ctx.hours,
    exceptions: ctx.exceptions,
    bookings: ctx.bookings,
    today: now.date,
    nowTime: now.time,
    durationMinutes: service?.duration_minutes ?? 30,
    stepMinutes: 30,
    capacity: Number((ctx.workspace.settings as { booking_capacity?: number } | null)?.booking_capacity ?? 1),
    busy: ctx.busy,
  }
  const pool = staffPool(ctx, d)
  const out: Record<string, string[]> = {}
  for (const day of date ? [date] : upcomingDates(now.date, PICKER_DAYS)) {
    const times = pool.length ? [...new Set(pool.flatMap((s) => freeSlotsForStaff(s, day, q)))].sort() : freeSlotsForBusiness(day, q)
    if (times.length) out[day] = times
  }
  return out
}

// ------------------------------------------------------------
// Details the business asks for (industry preset) + Calendly's email
// ------------------------------------------------------------

interface AskField {
  key: string
  type: 'text' | 'number' | 'email'
  label: string
}

function fieldsToAsk(env: Env, d: PickerDraft, extra: string[] = []): AskField[] {
  const { ctx, lang, t } = env
  const out: AskField[] = []
  for (const f of getPreset(ctx.workspace.industry).bookingFields) {
    if (f.type === 'product' || (!f.required && !extra.includes(f.key))) continue
    if (f.key === 'customer_name') {
      if (!d.customer_name && !env.contact.name) out.push({ key: f.key, type: 'text', label: f.label[lang] })
    } else if (f.key === 'party_size') {
      if (!d.party_size) out.push({ key: f.key, type: 'number', label: f.label[lang] })
    } else if (d.fields?.[f.key] === undefined || d.fields[f.key] === null || d.fields[f.key] === '') {
      out.push({ key: f.key, type: f.type === 'number' ? 'number' : 'text', label: f.label[lang] })
    }
  }
  // Calendly books with an email (its invitation goes there).
  const link = d.service_id ? ctx.calendly?.[d.service_id] : undefined
  const needsEmail = (link && link.canBook !== false && !env.contact.email) || extra.includes('email')
  if (needsEmail && !(typeof d.fields?.email === 'string' && d.fields.email)) out.push({ key: 'email', type: 'email', label: t('bookings.picker.email') })
  return out
}

function setField(d: PickerDraft, key: string, value: string | number): PickerDraft {
  if (key === 'customer_name') return { ...d, customer_name: String(value) }
  if (key === 'party_size') return { ...d, party_size: Number(value) }
  return { ...d, fields: { ...d.fields, [key]: value } }
}

// ------------------------------------------------------------
// Plumbing
// ------------------------------------------------------------

async function loadEnv(workspaceId: string, conversationId: string, contactId: string, opts: { senderUserId?: string | null; resumeFlow: boolean }): Promise<Env | null> {
  const ctx = await loadBusinessContext(workspaceId, true)
  if (!ctx) return null
  const contact = await tenantDb(workspaceId)
    .contacts.findFirst({ where: { id: contactId }, select: { name: true, email: true } })
    .catch(() => null)
  const lang: Lang = ctx.workspace.locale === 'en' ? 'en' : 'es'
  return {
    workspaceId,
    conversationId,
    contactId,
    ctx,
    lang,
    t: createTranslator(lang),
    contact: { name: contact?.name?.trim() || null, email: contact?.email?.trim() || null },
    senderUserId: opts.senderUserId ?? null,
    resumeFlow: opts.resumeFlow,
  }
}

/** Only ids of this workspace's rows survive (a flow step or the inbox may send stale ones). */
function cleanDraft(d: PickerDraft, ctx: BusinessContext): PickerDraft {
  return {
    service_id: d.service_id && ctx.services.some((s) => s.id === d.service_id) ? d.service_id : null,
    staff_id: d.staff_id && ctx.staff.some((s) => s.id === d.staff_id) ? d.staff_id : null,
    product_id: d.product_id ?? null,
    replaces: d.replaces ?? null,
  }
}

function liveState(raw: unknown): PickerState | null {
  if (!raw || typeof raw !== 'object') return null
  const s = raw as PickerState
  if (!s.step || !Array.isArray(s.options) || !s.draft) return null
  if (Date.parse(s.expires_at) < Date.now()) return null
  return { ...s, misses: s.misses ?? 0 }
}

async function saveState(workspaceId: string, conversationId: string, state: PickerState | null) {
  await tenantDb(workspaceId)
    .conversations.updateMany({
      where: { id: conversationId },
      data: { booking_picker: state === null ? Prisma.DbNull : (state as unknown as Prisma.InputJsonValue) },
    })
    .catch((err) => console.error('[picker] state save failed:', err instanceof Error ? err.message : err))
}

async function send(env: Env, content: Parameters<typeof sendMessage>[0]['content'], metadata: Record<string, unknown> = {}) {
  const userId = env.senderUserId
  // Only the first message comes from the team member who sent the schedule.
  env.senderUserId = null
  const result = await sendMessage({
    workspaceId: env.workspaceId,
    conversationId: env.conversationId,
    content,
    sender: userId ? { type: 'agent', userId } : { type: 'bot' },
    metadata: { source: 'booking_picker', ...metadata },
  })
  if (result.status === 'failed') console.error('[picker] send failed:', result.error)
}

function say(env: Env, text: string, metadata?: Record<string, unknown>) {
  return send(env, { type: 'text', text }, metadata)
}
