import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { sanitizePhoneForMeta, isValidE164 } from '@/lib/whatsapp/phone-utils'
import { defaultChannel, loadChannel } from '@/lib/channels/store'
import { sendMessage } from '@/lib/messaging/send'
import {
  findOrCreateContactByPhone,
  findOrCreateConversationOnChannel,
} from '@/lib/messaging/conversations'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language, channel_id?
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 *
 * `channel_id` (optional) picks the WhatsApp channel to send from;
 * defaults to the workspace's default WhatsApp channel. Each recipient
 * gets a contact + conversation on that channel and the template goes
 * out through sendMessage(), so it also shows up in the inbox.
 */
interface NewRecipient {
  phone: string
  params?: string[]
  components?: any[]
}

export async function POST(request: Request) {
  try {
    // Broadcasts are admin-only (RLS on broadcasts requires admin to write).
    const guard = await requireWorkspace('admin')
    if (!guard.ok) return guard.response
    const { user, workspace } = guard.ctx

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      channel_id,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const channel = channel_id
      ? await loadChannel(workspace.id, channel_id)
      : await defaultChannel(workspace.id, 'whatsapp')

    if (!channel || channel.type !== 'whatsapp') {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (const recipient of recipients) {
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      try {
        const contactId = await findOrCreateContactByPhone(workspace.id, sanitized)
        const conversationId = contactId
          ? await findOrCreateConversationOnChannel(channel, contactId)
          : null
        if (!conversationId) throw new Error('Could not create a conversation for this recipient')

        const result = await sendMessage({
          workspaceId: workspace.id,
          conversationId,
          content: {
            type: 'template',
            templateName: template_name,
            language: template_language || 'en_US',
            params: recipient.params,
            components: recipient.components,
          },
          sender: { type: 'agent', userId: user.id },
          metadata: { source: 'broadcast' },
        })

        if (result.status === 'failed') throw new Error(result.error || 'Send failed')
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: result.externalId ?? undefined,
        })
        sentCount++
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error'
        console.error(`Failed to send broadcast to ${recipient.phone}:`, errorMessage)
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: errorMessage,
        })
        failedCount++
      }
    }

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
