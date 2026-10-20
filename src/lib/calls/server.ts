import 'server-only'
import type { Prisma } from '@/generated/prisma/client'
import { tenantDb } from '@/lib/db/tenant'
import { isPrismaError } from '@/lib/db/errors'
import type { LoadedChannel } from '@/lib/channels/types'
import { findOrCreateContact, findOrCreateConversation } from '@/lib/messaging/ingest'
import { recordEvent } from '@/lib/inbox/server'
import { callAction, messagingTier, updateCallingSettings } from './meta'
import { callingSettingsBody, finalStatus, formatDuration, isLive, type CallEvent, type CallingState, type CallStatus } from './model'

const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---------------------------------------------------------------- webhook

/** A customer is calling: the row makes every open inbox of the workspace ring. */
async function onConnect(channel: LoadedChannel, ev: Extract<CallEvent, { kind: 'connect' }>) {
  const db = tenantDb(channel.workspace_id)
  const contact = await findOrCreateContact(channel, {
    externalId: ev.phone ?? ev.userId!,
    phone: ev.phone,
    userId: ev.userId,
    name: ev.name,
    handle: ev.phone,
  })
  const conversation = contact ? await findOrCreateConversation(channel, contact.id) : null
  try {
    await db.whatsapp_calls.create({
      data: {
        workspace_id: channel.workspace_id,
        channel_id: channel.id,
        call_id: ev.callId,
        contact_id: contact?.id ?? null,
        conversation_id: conversation?.id ?? null,
        sdp_offer: ev.sdp,
        created_at: new Date(ev.timestamp),
      },
    })
  } catch (err) {
    // Meta retried the webhook: the call is already ringing.
    if (!isPrismaError(err, 'P2002')) throw err
  }
}

/** The call ended (or was never picked up): close the row and leave it in the conversation. */
async function onTerminate(channel: LoadedChannel, ev: Extract<CallEvent, { kind: 'terminate' }>) {
  const db = tenantDb(channel.workspace_id)
  const row = await db.whatsapp_calls.findFirst({ where: { channel_id: channel.id, call_id: ev.callId } })
  if (!row || (!isLive(row.status) && row.status !== 'rejected') || row.ended_at) return
  const status = finalStatus(row.status, ev)
  const ended = new Date(ev.timestamp)
  const duration = status === 'completed' ? ev.durationSeconds ?? secondsBetween(row.answered_at, ended) : null
  const closed = await db.whatsapp_calls.updateMany({
    where: { id: row.id, ended_at: null },
    data: { status, ended_at: ended, duration_seconds: duration, error: ev.error, sdp_offer: null, updated_at: new Date() },
  })
  if (closed.count === 0 || !row.conversation_id) return
  await logInConversation(channel.workspace_id, row.conversation_id, { status, duration, answeredBy: row.answered_by, callId: row.call_id, at: ended })
}

function secondsBetween(from: Date | string | null, to: Date): number | null {
  return from ? Math.max(0, Math.round((to.getTime() - new Date(from).getTime()) / 1000)) : null
}

async function logInConversation(
  workspaceId: string,
  conversationId: string,
  c: { status: CallStatus; duration: number | null; answeredBy: string | null; callId: string; at: Date },
) {
  const db = tenantDb(workspaceId)
  await recordEvent({
    workspaceId,
    conversationId,
    type: 'call',
    fromUser: c.status === 'completed' ? c.answeredBy : null,
    data: { status: c.status, duration: c.duration, call_id: c.callId, direction: 'inbound' },
  })
  const ws = await db.workspaces.findFirst({ where: { id: workspaceId }, select: { locale: true } })
  const en = ws?.locale === 'en'
  const preview =
    c.status === 'completed'
      ? `📞 ${en ? 'Call' : 'Llamada'} · ${formatDuration(c.duration)}`
      : c.status === 'rejected'
        ? `📞 ${en ? 'Call declined' : 'Llamada rechazada'}`
        : `📞 ${en ? 'Missed call' : 'Llamada perdida'}`
  await db.conversations.updateMany({
    where: { id: conversationId },
    data: {
      last_message_text: preview,
      last_message_at: c.at,
      updated_at: c.at,
      ...(c.status === 'missed' ? { unread_count: { increment: 1 } } : {}),
    },
  })
}

export async function handleCallEvents(channel: LoadedChannel, events: CallEvent[]): Promise<void> {
  for (const ev of events) {
    try {
      if (ev.kind === 'connect') await onConnect(channel, ev)
      else await onTerminate(channel, ev)
    } catch (err) {
      console.error(`[calls] ${ev.kind} failed:`, message(err))
    }
  }
}

// ---------------------------------------------------------------- agents

export type CallStepError = 'not_found' | 'taken' | 'not_yours' | 'ended' | 'provider'

export type CallStepResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: CallStepError; message?: string }

async function loadCall(workspaceId: string, id: string) {
  return tenantDb(workspaceId).whatsapp_calls.findFirst({ where: { id } })
}

/** First to click "Answer" gets the call (and WhatsApp's WebRTC offer). */
export async function claimCall(workspaceId: string, id: string, userId: string): Promise<CallStepResult<{ sdpOffer: string }>> {
  const db = tenantDb(workspaceId)
  const call = await loadCall(workspaceId, id)
  if (!call) return { ok: false, error: 'not_found' }
  if (!isLive(call.status)) return { ok: false, error: 'ended' }
  const won = await db.whatsapp_calls.updateMany({
    where: { id, status: 'ringing' },
    data: { status: 'answering', answered_by: userId, updated_at: new Date() },
  })
  if (won.count === 0) return { ok: false, error: 'taken' }
  if (!call.sdp_offer) return { ok: false, error: 'ended' }
  return { ok: true, sdpOffer: call.sdp_offer }
}

/** The answering browser couldn't set up audio (no microphone…): let someone else take it. */
export async function releaseCall(workspaceId: string, id: string, userId: string): Promise<void> {
  await tenantDb(workspaceId).whatsapp_calls.updateMany({
    where: { id, status: 'answering', answered_by: userId },
    data: { status: 'ringing', answered_by: null, updated_at: new Date() },
  })
}

type Loaded = (channelId: string) => Promise<LoadedChannel | null>

async function ownCall(workspaceId: string, id: string, userId: string, statuses: string[]) {
  const call = await loadCall(workspaceId, id)
  if (!call) return { error: 'not_found' as const }
  if (!statuses.includes(call.status)) return { error: isLive(call.status) ? ('not_yours' as const) : ('ended' as const) }
  if (call.answered_by !== userId) return { error: 'not_yours' as const }
  return { call }
}

/**
 * WebRTC answer from the browser. pre_accept lets the media connect before
 * the call is picked up; accept (same SDP, once the browser is connected)
 * starts it. Meta requires the same answer in both.
 */
export async function answerStep(
  workspaceId: string,
  id: string,
  userId: string,
  step: 'pre_accept' | 'accept',
  sdp: string,
  loadChannel: Loaded,
): Promise<CallStepResult> {
  const found = await ownCall(workspaceId, id, userId, ['answering'])
  if ('error' in found) return { ok: false, error: found.error! }
  const channel = await loadChannel(found.call.channel_id)
  if (!channel) return { ok: false, error: 'not_found' }
  try {
    await callAction(channel, found.call.call_id, step, sdp)
  } catch (err) {
    await failCall(workspaceId, id, message(err))
    return { ok: false, error: 'provider', message: message(err) }
  }
  if (step === 'accept') {
    await tenantDb(workspaceId).whatsapp_calls.updateMany({
      where: { id, status: 'answering' },
      data: { status: 'in_progress', answered_at: new Date(), updated_at: new Date() },
    })
  }
  return { ok: true }
}

async function failCall(workspaceId: string, id: string, error: string) {
  await tenantDb(workspaceId).whatsapp_calls.updateMany({
    where: { id, ended_at: null },
    data: { status: 'failed', error: error.slice(0, 500), ended_at: new Date(), sdp_offer: null, updated_at: new Date() },
  })
}

/** Nobody wants it: WhatsApp tells the caller and the row stays as rejected. */
export async function rejectCall(workspaceId: string, id: string, loadChannel: Loaded): Promise<CallStepResult> {
  const db = tenantDb(workspaceId)
  const call = await loadCall(workspaceId, id)
  if (!call) return { ok: false, error: 'not_found' }
  const won = await db.whatsapp_calls.updateMany({ where: { id, status: 'ringing' }, data: { status: 'rejected', updated_at: new Date() } })
  if (won.count === 0) return { ok: false, error: isLive(call.status) ? 'taken' : 'ended' }
  const channel = await loadChannel(call.channel_id)
  if (channel) await callAction(channel, call.call_id, 'reject').catch((err) => console.warn('[calls] reject failed:', message(err)))
  return { ok: true }
}

/** The agent hangs up. Meta's terminate webhook then closes the row with the duration. */
export async function hangUp(workspaceId: string, id: string, userId: string, loadChannel: Loaded): Promise<CallStepResult> {
  const found = await ownCall(workspaceId, id, userId, ['answering', 'in_progress'])
  if ('error' in found) return { ok: false, error: found.error! }
  const channel = await loadChannel(found.call.channel_id)
  if (channel) await callAction(channel, found.call.call_id, 'terminate').catch((err) => console.warn('[calls] terminate failed:', message(err)))
  // Close it here too, in case the webhook is late or lost.
  const now = new Date()
  const talked = found.call.status === 'in_progress'
  const duration = talked ? secondsBetween(found.call.answered_at, now) : null
  const closed = await tenantDb(workspaceId).whatsapp_calls.updateMany({
    where: { id, ended_at: null },
    data: { status: talked ? 'completed' : 'missed', ended_at: now, duration_seconds: duration, sdp_offer: null, updated_at: now },
  })
  if (closed.count && found.call.conversation_id) {
    await logInConversation(workspaceId, found.call.conversation_id, {
      status: talked ? 'completed' : 'missed',
      duration,
      answeredBy: userId,
      callId: found.call.call_id,
      at: now,
    })
  }
  return { ok: true }
}

/** Calls still going in the workspace (for an inbox opened mid-ring). Never includes the SDP. */
export async function liveCalls(workspaceId: string) {
  return tenantDb(workspaceId).whatsapp_calls.findMany({
    where: { status: { in: ['ringing', 'answering', 'in_progress'] }, created_at: { gt: new Date(Date.now() - 2 * 3600_000) } },
    orderBy: { created_at: 'asc' },
    select: CALL_PUBLIC_SELECT,
  })
}

export const CALL_PUBLIC_SELECT = {
  id: true,
  channel_id: true,
  conversation_id: true,
  contact_id: true,
  status: true,
  answered_by: true,
  answered_at: true,
  ended_at: true,
  duration_seconds: true,
  created_at: true,
  contacts: { select: { name: true, phone: true } },
} satisfies Prisma.whatsapp_callsSelect

// ---------------------------------------------------------------- settings

export type CallingSetupError = 'coexistence' | 'not_whatsapp' | 'provider'

async function callingSettingsBodyFor(workspaceId: string, opts: { enabled: boolean; useBusinessHours: boolean }) {
  if (!opts.enabled || !opts.useBusinessHours) return callingSettingsBody({ enabled: opts.enabled })
  const db = tenantDb(workspaceId)
  const [ws, rows] = await Promise.all([
    db.workspaces.findFirst({ where: { id: workspaceId }, select: { timezone: true } }),
    db.business_hours.findMany({ select: { day_name: true, opening_time: true, closing_time: true, is_closed: true, break_start: true, break_end: true } }),
  ])
  return callingSettingsBody({ enabled: true, hours: { timezone: ws?.timezone || 'UTC', rows } })
}

/**
 * Turns calling on/off on the number (optionally limited to the business
 * hours) and stores the outcome in channels.settings.calling.
 */
export async function setCalling(
  channel: LoadedChannel,
  opts: { enabled: boolean; useBusinessHours: boolean },
): Promise<{ ok: true; state: CallingState } | { ok: false; error: CallingSetupError; message?: string; state?: CallingState }> {
  if (channel.type !== 'whatsapp') return { ok: false, error: 'not_whatsapp' }
  if (opts.enabled && channel.settings?.coexistence === true) return { ok: false, error: 'coexistence' }
  const db = tenantDb(channel.workspace_id)
  const tier = await messagingTier(channel).catch(() => null)
  let error: string | null = null
  try {
    await updateCallingSettings(channel, await callingSettingsBodyFor(channel.workspace_id, opts))
  } catch (err) {
    error = message(err)
  }
  const state: CallingState = {
    enabled: opts.enabled && !error,
    use_business_hours: opts.useBusinessHours,
    tier,
    error,
    updated_at: new Date().toISOString(),
  }
  const row = await db.channels.findFirst({ where: { id: channel.id }, select: { settings: true } })
  const settings: Record<string, unknown> = { ...((row?.settings as Record<string, unknown>) ?? {}), calling: { ...state } }
  await db.channels.updateMany({ where: { id: channel.id }, data: { settings: settings as Prisma.InputJsonObject } })
  return error ? { ok: false, error: 'provider', message: error, state } : { ok: true, state }
}
