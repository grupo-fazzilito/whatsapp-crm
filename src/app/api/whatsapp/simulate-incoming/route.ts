import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
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
    const { supabase, workspace } = guard.ctx

    const body = await request.json()
    const { conversationId, messageText } = body

    if (!conversationId || !messageText) {
      return NextResponse.json(
        { error: 'conversationId and messageText are required' },
        { status: 400 }
      )
    }

    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, channel_id, contact:contacts(id, name, phone)')
      .eq('id', conversationId)
      .eq('workspace_id', workspace.id)
      .single()

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = (Array.isArray(conversation.contact) ? conversation.contact[0] : conversation.contact) as
      | { id: string; name: string | null; phone: string | null }
      | null
    if (!contact) {
      return NextResponse.json(
        { error: 'Contact not found' },
        { status: 400 }
      )
    }

    const db = supabaseAdmin()
    const channel = conversation.channel_id
      ? await loadChannel(workspace.id, conversation.channel_id)
      : await defaultChannel(workspace.id, 'whatsapp')
    if (!channel) {
      return NextResponse.json({ error: 'No channel connected for this conversation' }, { status: 400 })
    }
    // Legacy conversation without channel: attach it so ingest lands the
    // message here instead of opening a new conversation.
    if (!conversation.channel_id) {
      await db.from('conversations').update({ channel_id: channel.id }).eq('id', conversation.id)
    }

    // The customer's id on this channel (identity, or phone on WhatsApp).
    const { data: identity } = await db
      .from('contact_identities')
      .select('external_id, handle')
      .eq('workspace_id', workspace.id)
      .eq('contact_id', contact.id)
      .eq('channel_type', channel.type)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
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
    const { count: botReplies } = await db
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', outcome.conversationId)
      .eq('sender_type', 'bot')
      .gte('created_at', new Date(now).toISOString())

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
