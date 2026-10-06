import { NextResponse, after } from 'next/server'
import crypto from 'node:crypto'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { decrypt } from '@/lib/whatsapp/encryption'
import { parseWhatsAppWebhook, type WaWebhookBody } from '@/lib/channels/parsers/whatsapp'
import { parseMetaMessagingWebhook, type MetaMessagingBody } from '@/lib/channels/parsers/meta-messaging'
import { findChannelByExternalId } from '@/lib/channels/store'
import { ingestEvents } from '@/lib/messaging/ingest'
import type { ChannelType, InboundEvent } from '@/lib/channels'

// One callback URL for the platform's Meta app: WhatsApp Business,
// Messenger (object=page) and Instagram (object=instagram).

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb)
}

/** Platform token (META_VERIFY_TOKEN) or any channel's own verify token. */
async function verifyTokenMatches(token: string): Promise<boolean> {
  const platform = process.env.META_VERIFY_TOKEN
  if (platform && safeEqual(platform, token)) return true

  const { data } = await supabaseAdmin().from('channel_secrets').select('secrets')
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

export async function POST(request: Request) {
  // Verify the exact bytes Meta signed.
  const rawBody = await request.text()
  if (!verifyMetaWebhookSignature(rawBody, request.headers.get('x-hub-signature-256'))) {
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: { object?: string }
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = parse(body)
  if (parsed && parsed.events.length > 0) {
    // Ack within Meta's timeout; process after the response is sent.
    after(() => dispatch(parsed.type, parsed.events).catch((err) => console.error('[webhook] dispatch failed:', err)))
  }
  return NextResponse.json({ status: 'received' }, { status: 200 })
}
