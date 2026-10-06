import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { sendMessage } from '@/lib/messaging/send'
import type { OutboundContent } from '@/lib/channels'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

const MEDIA_TYPES = ['image', 'video', 'audio', 'document'] as const
type MediaType = (typeof MEDIA_TYPES)[number]

/** How long the AI agent stays quiet after a human replies. */
const HUMAN_TAKEOVER_MS = 12 * 60 * 60 * 1000

/**
 * Agent reply from the inbox. Goes out through the conversation's channel
 * (WhatsApp, Messenger, Instagram, web chat...) via sendMessage().
 *
 * Body: { conversation_id, message_type: 'text'|'template'|'image'|'video'|
 * 'audio'|'document', content_text?, media_url?, template_name?,
 * template_params?, template_language?, reply_to_message_id? }
 * → { success, message_id, whatsapp_message_id }
 */
export async function POST(request: Request) {
  try {
    const guard = await requireWorkspace()
    if (!guard.ok) return guard.response
    const { supabase, user, workspace } = guard.ctx

    // Per-user rate limit. Bucket key is scoped to this route so
    // `/broadcast` has an independent budget.
    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      conversation_id,
      message_type,
      content_text,
      media_url,
      template_name,
      template_params,
      template_language,
      reply_to_message_id,
    } = body

    if (!conversation_id || !message_type) {
      return NextResponse.json(
        { error: 'conversation_id and message_type are required' },
        { status: 400 }
      )
    }

    let content: OutboundContent
    if (message_type === 'text') {
      if (!content_text) {
        return NextResponse.json(
          { error: 'content_text is required for text messages' },
          { status: 400 }
        )
      }
      content = { type: 'text', text: content_text }
    } else if (message_type === 'template') {
      if (!template_name) {
        return NextResponse.json(
          { error: 'template_name is required for template messages' },
          { status: 400 }
        )
      }
      let language: string | undefined = template_language || undefined
      if (!language) {
        const { data: tpl } = await supabase
          .from('message_templates')
          .select('language')
          .eq('workspace_id', workspace.id)
          .eq('name', template_name)
          .limit(1)
          .maybeSingle()
        language = tpl?.language || undefined
      }
      content = {
        type: 'template',
        templateName: template_name,
        language,
        params: Array.isArray(template_params) ? template_params.map(String) : [],
      }
    } else if ((MEDIA_TYPES as readonly string[]).includes(message_type)) {
      if (!media_url) {
        return NextResponse.json(
          { error: 'media_url is required for media messages' },
          { status: 400 }
        )
      }
      content = {
        type: 'media',
        mediaType: message_type as MediaType,
        url: media_url,
        caption: content_text || undefined,
      }
    } else {
      return NextResponse.json({ error: `Unsupported message_type: ${message_type}` }, { status: 400 })
    }

    // Conversation must be visible to the caller (RLS + explicit scope).
    const { data: conversation, error: convError } = await supabase
      .from('conversations')
      .select('id, contact_id')
      .eq('id', conversation_id)
      .eq('workspace_id', workspace.id)
      .single()

    if (convError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    // The reply target must belong to this same conversation — otherwise a
    // caller could quote messages they can't see by guessing UUIDs.
    if (reply_to_message_id) {
      const { data: parent, error: parentError } = await supabase
        .from('messages')
        .select('id')
        .eq('id', reply_to_message_id)
        .eq('conversation_id', conversation_id)
        .maybeSingle()

      if (parentError || !parent) {
        return NextResponse.json(
          { error: 'reply_to_message_id not found in this conversation' },
          { status: 400 }
        )
      }
    }

    const result = await sendMessage({
      workspaceId: workspace.id,
      conversationId: conversation_id,
      content,
      sender: { type: 'agent', userId: user.id },
      replyToMessageId: reply_to_message_id || null,
    })

    const db = supabaseAdmin()

    // Templates: keep the rendered body the inbox showed optimistically
    // instead of the generic "[Template: name]" preview.
    if (message_type === 'template' && content_text) {
      await db
        .from('messages')
        .update({ content_text })
        .eq('id', result.messageId)
        .eq('workspace_id', workspace.id)
    }

    if (result.status === 'failed') {
      const error = result.error || 'Send failed'
      const status = /not connected|not configured|no .* identity|no phone|unsupported/i.test(error) ? 400 : 502
      return NextResponse.json({ error, message_id: result.messageId }, { status })
    }

    // A human replied: keep the AI agent quiet so it doesn't talk over them.
    const { error: pauseAiErr } = await db
      .from('conversations')
      .update({ ai_paused_until: new Date(Date.now() + HUMAN_TAKEOVER_MS).toISOString() })
      .eq('id', conversation_id)
      .eq('workspace_id', workspace.id)
    if (pauseAiErr) console.error('[whatsapp/send] ai_paused_until update failed:', pauseAiErr.message)

    // Pause any active Flow run for this contact — the agent stepping
    // in is the strongest "yield, human is here" signal. We pause (not
    // end) to preserve diagnostic state; the 24h timeout sweep resolves
    // the run later. With no active runs the UPDATE matches zero rows.
    try {
      const { error: pauseErr } = await db
        .from('flow_runs')
        .update({
          status: 'paused_by_agent',
          ended_at: new Date().toISOString(),
          end_reason: 'agent_replied',
        })
        .eq('workspace_id', workspace.id)
        .eq('contact_id', conversation.contact_id)
        .eq('status', 'active')
      if (pauseErr) {
        // Best-effort — the message already went out; a stale active run
        // gets caught by the stale-run cron sweep within 24h.
        console.error('[flows] pause-on-agent-send failed:', pauseErr.message)
      }
    } catch (err) {
      console.error(
        '[flows] pause-on-agent-send threw:',
        err instanceof Error ? err.message : err,
      )
    }

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      whatsapp_message_id: result.externalId,
    })
  } catch (error) {
    console.error('Error in WhatsApp send POST:', error)
    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}
