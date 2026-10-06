import type { InteractiveButton, InteractiveListSection } from '@/lib/whatsapp/meta-api'
import type { OutboundContent } from '@/lib/channels'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Flows-side sender (text + interactive variants).
//
// Thin wrapper over the channel layer's sendMessage(): the prompt goes
// out through the conversation's channel (native buttons/lists where
// the channel supports them, a numbered text menu otherwise) and is
// stored as a bot message. The exported signatures / return shape are
// what the flow engine expects; `whatsapp_message_id` is the provider
// message id (empty for channels without one, e.g. web chat).
// ------------------------------------------------------------

interface EngineIds {
  workspaceId: string
  conversationId: string
  contactId: string
}

interface SendTextEngineArgs extends EngineIds {
  text: string
}

interface SendInteractiveButtonsEngineArgs extends EngineIds {
  bodyText: string
  buttons: InteractiveButton[]
  headerText?: string
  footerText?: string
}

interface SendInteractiveListEngineArgs extends EngineIds {
  bodyText: string
  buttonLabel: string
  sections: InteractiveListSection[]
  headerText?: string
  footerText?: string
}

/**
 * Send a plain-text message from the Flows engine.
 *
 * Used by the runner's `send_message` and `collect_input` nodes —
 * both prompt the customer with text and either auto-advance (the
 * send_message case) or suspend awaiting a text reply (collect_input).
 */
export async function engineSendText(
  args: SendTextEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return engineSend(args, { type: 'text', text: args.text })
}

/**
 * Send an interactive-button message from the Flows engine.
 *
 * Stored with `content_type='interactive'` and `sender_type='bot'` so
 * the inbox surfaces it and the conversation thread reflects the
 * bot's prompt. The returned provider id lets the engine find the
 * stored row and stash it on `flow_runs.last_prompt_message_id`.
 */
export async function engineSendInteractiveButtons(
  args: SendInteractiveButtonsEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return engineSend(args, {
    type: 'buttons',
    text: args.bodyText,
    header: args.headerText,
    footer: args.footerText,
    options: args.buttons.map((b) => ({ id: b.id, title: b.title })),
  })
}

/**
 * Send an interactive-list message from the Flows engine.
 * Used when the flow needs more than 3 options (Meta's button cap).
 */
export async function engineSendInteractiveList(
  args: SendInteractiveListEngineArgs,
): Promise<{ whatsapp_message_id: string }> {
  return engineSend(args, {
    type: 'list',
    text: args.bodyText,
    buttonLabel: args.buttonLabel,
    header: args.headerText,
    footer: args.footerText,
    sections: args.sections.map((s) => ({
      title: s.title,
      options: s.rows.map((r) => ({ id: r.id, title: r.title, description: r.description })),
    })),
  })
}

async function engineSend(ids: EngineIds, content: OutboundContent): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact / conversation lookups by workspace_id — the
  // service-role client bypasses RLS, so a contact_id from another
  // tenant must never be reachable from this workspace's flows.
  const { data: contact, error: contactErr } = await db
    .from('contacts')
    .select('id')
    .eq('id', ids.contactId)
    .eq('workspace_id', ids.workspaceId)
    .maybeSingle()
  if (contactErr || !contact) {
    throw new Error('contact not found for this workspace')
  }

  const { data: conversation } = await db
    .from('conversations')
    .select('id')
    .eq('id', ids.conversationId)
    .eq('workspace_id', ids.workspaceId)
    .maybeSingle()
  if (!conversation) {
    throw new Error('conversation not found for this workspace')
  }

  // Lazy: messaging/send is server-only and the engine's pure helpers are
  // unit-tested outside Next.
  const { sendMessage } = await import('@/lib/messaging/send')
  const result = await sendMessage({
    workspaceId: ids.workspaceId,
    conversationId: ids.conversationId,
    content,
    sender: { type: 'bot' },
    metadata: { source: 'flow' },
  })
  if (result.status === 'failed') {
    throw new Error(result.error || 'send failed')
  }
  return { whatsapp_message_id: result.externalId ?? '' }
}
