import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { defaultChannel, loadChannel } from '@/lib/channels/store'
import { ingestMessage } from '@/lib/messaging/ingest'
import type { InboundEvent } from '@/lib/channels'
import { normalizePhone } from '@/lib/whatsapp/phone-utils'

/**
 * Dev tool (inbox simulator): pretends the conversation's customer sent
 * `messageText` on the conversation's channel and runs it through the
 * real inbound pipeline (ingestMessage → AI agent → flows → automations).
 *
 * Body: { conversationId, messageText } → { success, message_id, aiHandled }
 */
export async function POST(request: Request) {
  try {
    const guard = await requireWorkspace()
    if (!guard.ok) return guard.response
    const { db, workspace } = guard.ctx

    const body = await request.json()
    const { conversationId, messageText } = body

    if (!conversationId || !messageText) {
      return NextResponse.json(
        { error: 'conversationId and messageText are required' },
        { status: 400 }
      )
    }

    // A malformed id fails the query: same 404 as a missing row.
    const conversation = await db.conversations
      .findFirst({
        select: { id: true, channel_id: true, contacts: { select: { id: true, name: true, phone: true } } },
        where: { id: conversationId, workspace_id: workspace.id },
      })
      .catch(() => null)

    if (!conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = conversation.contacts as { id: string; name: string | null; phone: string | null } | null
    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 400 }
      )
    }

    const channel = conversation.channel_id
      ? await loadChannel(workspace.id, conversation.channel_id)
      : await defaultChannel(workspace.id, 'whatsapp')
    if (!channel) {
      return NextResponse.json({ error: 'No channel connected for this conversation' }, { status: 400 })
    }
    // Legacy conversation without channel: attach it so ingest lands the
    // message here instead of opening a new conversation.
    if (!conversation.channel_id) {
      await db.conversations.updateMany({ where: { id: conversation.id }, data: { channel_id: channel.id } }).catch(() => {})
    }

    // The customer's id on this channel (identity, or phone on WhatsApp).
    const identity = await db.contact_identities
      .findFirst({
        select: { external_id: true, handle: true },
        where: { workspace_id: workspace.id, contact_id: contact.id, channel_type: channel.type },
        orderBy: { created_at: 'desc' },
      })
      .catch(() => null)
    const externalId =
      identity?.external_id ?? (channel.type === 'whatsapp' && contact.phone ? normalizePhone(contact.phone) : null)
    if (!externalId) {
      return NextResponse.json({ error: `Contact has no ${channel.type} identity` }, { status: 400 })
    }

    const now = Date.now()
    const event: Extract<InboundEvent, { kind: 'message' }> = {
      kind: 'message',
      channelExternalId: channel.external_id,
      from: {
        externalId,
        name: contact.name,
        handle: identity?.handle ?? null,
        phone: channel.type === 'whatsapp' ? contact.phone : null,
      },
      externalMessageId: `sim-user-${now}`,
      timestamp: now,
      contentType: 'text',
      text: String(messageText),
    }

    const outcome = await ingestMessage(channel, event)
    if (!outcome?.messageId) {
      return NextResponse.json({ error: 'Failed to ingest simulated message' }, { status: 500 })
    }

    // Did the AI agent answer? (a bot message after the simulated one)
    const botReplies = await db.messages
      .count({
        where: { conversation_id: outcome.conversationId, sender_type: 'bot', created_at: { gte: new Date(now).toISOString() } },
      })
      .catch(() => null)

    return NextResponse.json({
      success: true,
      message_id: outcome.messageId,
      aiHandled: (botReplies ?? 0) > 0,
    })
  } catch (error: any) {
    console.error('Error in Simulate Incoming POST:', error)
    return NextResponse.json(
      { error: error.message || 'Internal Server Error' },
      { status: 500 }
    )
  }
}
