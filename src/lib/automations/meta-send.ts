import type { OutboundContent } from '@/lib/channels'
import { tenantDb } from '@/lib/db/tenant'

// ------------------------------------------------------------
// Automation-side sender.
//
// Thin wrapper over the channel layer's sendMessage(): the message goes
// out through the conversation's channel (WhatsApp, Messenger, ...) and
// is stored as a bot message. Kept as its own module so the engine's
// call sites and return shape don't change.
// ------------------------------------------------------------

/** Extra data about who/what is sending. */
export interface EngineSendExtra {
  automationId?: string
  /** Sent by a follow-up (no_reply) run: never re-arms follow-ups. */
  followup?: boolean
  /** Message written by this AI agent (ai_followup). */
  aiAgentId?: string | null
}

interface SendTextArgs {
  workspaceId: string
  conversationId: string
  contactId: string
  text: string
  extra?: EngineSendExtra
}

interface SendTemplateArgs {
  workspaceId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
  extra?: EngineSendExtra
}

export async function engineSendText(args: SendTextArgs): Promise<{ whatsapp_message_id: string }> {
  return engineSend(args, { type: 'text', text: args.text })
}

export async function engineSendTemplate(
  args: SendTemplateArgs,
): Promise<{ whatsapp_message_id: string }> {
  return engineSend(args, {
    type: 'template',
    templateName: args.templateName,
    language: args.language,
    params: args.params,
  })
}

async function engineSend(
  ids: { workspaceId: string; conversationId: string; contactId: string; extra?: EngineSendExtra },
  content: OutboundContent,
): Promise<{ whatsapp_message_id: string }> {
  const db = tenantDb(ids.workspaceId)

  // Scope the contact / conversation lookups by workspace_id. The engine
  // uses a server-side client (no RLS), and the public
  // /api/automations/engine endpoint accepts contact_id and
  // conversation_id from the request body — without these filters, an
  // authenticated member could fire their workspace's automations
  // against another tenant's contact. Cheap defense-in-depth.
  const contact = await db.contacts
    .findFirst({ select: { id: true }, where: { id: ids.contactId, workspace_id: ids.workspaceId } })
    .catch(() => null)
  if (!contact) {
    throw new Error('contact not found for this workspace')
  }

  const conversation = await db.conversations
    .findFirst({ select: { id: true }, where: { id: ids.conversationId, workspace_id: ids.workspaceId } })
    .catch(() => null)
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
    sender: { type: 'bot', aiAgentId: ids.extra?.aiAgentId ?? null },
    metadata: {
      source: 'automation',
      ...(ids.extra?.automationId ? { automation_id: ids.extra.automationId } : {}),
      ...(ids.extra?.followup ? { followup: true } : {}),
    },
  })
  if (result.status === 'failed') {
    throw new Error(result.error || 'send failed')
  }
  return { whatsapp_message_id: result.externalId ?? '' }
}
