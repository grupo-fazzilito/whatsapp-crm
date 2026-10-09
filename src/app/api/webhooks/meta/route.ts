import { NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { prisma } from '@/lib/db/prisma'
import { verifyMetaWebhookRequest } from '@/lib/whatsapp/webhook-signature'
import { getMetaConfig } from '@/lib/platform/meta'
import { decrypt } from '@/lib/whatsapp/encryption'
import { parseWhatsAppCoexistence, parseWhatsAppWebhook, type CoexBatch, type WaWebhookBody } from '@/lib/channels/parsers/whatsapp'
import { parseMetaMessagingWebhook, type MetaMessagingBody } from '@/lib/channels/parsers/meta-messaging'
import { findChannelByExternalId } from '@/lib/channels/store'
import { ingestEvents } from '@/lib/messaging/ingest'
import { applyCoexBatch } from '@/lib/messaging/echo'
import type { ChannelType, InboundEvent } from '@/lib/channels'

// One callback URL for the platform's Meta app: WhatsApp Business,
// Messenger (object=page) and Instagram (object=instagram).

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

/** Platform token (admin panel → META_VERIFY_TOKEN) or any channel's own verify token. */
async function verifyTokenMatches(token: string): Promise<boolean> {
  const platform = (await getMetaConfig()).verifyToken
  if (platform && safeEqual(platform, token)) return true

  // Platform-level: the channel (and its workspace) is not known yet.
  const data = await prisma.channel_secrets.findMany({ select: { secrets: true } }).catch(() => null)
  for (const row of data ?? []) {
    const enc = (row.secrets as Record<string, string>)?.verify_token
    if (!enc) continue
    try {
      if (safeEqual(decrypt(enc), token)) return true
    } catch {
      // undecryptable secret: ignore
    }
  }
  return false
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const mode = params.get('hub.mode')
  const challenge = params.get('hub.challenge')
  const token = params.get('hub.verify_token')
  if (mode !== 'subscribe' || !challenge || !token) {
    return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 })
  }
  if (!(await verifyTokenMatches(token))) {
    return NextResponse.json({ error: 'Verification failed' }, { status: 403 })
  }
  return new NextResponse(challenge, { status: 200 })
}

function parse(body: { object?: string }): { type: ChannelType; events: InboundEvent[] } | null {
  switch (body.object) {
    case 'whatsapp_business_account':
      return { type: 'whatsapp', events: parseWhatsAppWebhook(body as WaWebhookBody) }
    case 'page':
      return { type: 'messenger', events: parseMetaMessagingWebhook(body as MetaMessagingBody) }
    case 'instagram':
      return { type: 'instagram', events: parseMetaMessagingWebhook(body as MetaMessagingBody) }
    default:
      return null
  }
}

async function dispatch(type: ChannelType, events: InboundEvent[]) {
  const byChannel = new Map<string, InboundEvent[]>()
  for (const ev of events) {
    const list = byChannel.get(ev.channelExternalId) ?? []
    list.push(ev)
    byChannel.set(ev.channelExternalId, list)
  }
  for (const [externalId, list] of byChannel) {
    const channel = await findChannelByExternalId(type, externalId)
    if (!channel) {
      console.warn(`[webhook] no ${type} channel for external id ${externalId}; ignoring ${list.length} event(s)`)
      continue
    }
    await ingestEvents(channel, list)
  }
}

async function dispatchCoexistence(batches: CoexBatch[]) {
  for (const batch of batches) {
    const channel = await findChannelByExternalId('whatsapp', batch.phoneNumberId)
    if (!channel) {
      console.warn(`[webhook] no whatsapp channel for ${batch.phoneNumberId}; ignoring coexistence event`)
      continue
    }
    await applyCoexBatch(channel, batch)
  }
}

export async function POST(request: Request) {
  // Verify the exact bytes Meta signed: the platform app first, then the
  // own Meta app of the channels the payload claims (manual setups).
  const rawBody = await request.text()
  const trust = await verifyMetaWebhookRequest(rawBody, request.headers.get('x-hub-signature-256'))
  if (!trust.ok) {
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }
  // Signed by a channel's own app: only that app's accounts are processed.
  const allowed = trust.via === 'channel' ? new Set(trust.externalIds) : null

  let body: { object?: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = parse(body)
  const events = parsed ? parsed.events.filter((e) => !allowed || allowed.has(e.channelExternalId)) : []
  const coex =
    body.object === 'whatsapp_business_account'
      ? parseWhatsAppCoexistence(body as WaWebhookBody).filter((b) => !allowed || allowed.has(b.phoneNumberId))
      : []
  if (parsed && events.length > 0) {
    // Ack within Meta's timeout; process after the response is sent.
    after(() => dispatch(parsed.type, events).catch((err) => console.error('[webhook] dispatch failed:', err)))
  }
  if (coex.length > 0) {
    after(() => dispatchCoexistence(coex).catch((err) => console.error('[webhook] coexistence failed:', err)))
  }
  return NextResponse.json({ status: 'received' }, { status: 200 })
}
