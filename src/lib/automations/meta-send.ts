import type { OutboundContent } from '@/lib/channels'
import { supabaseAdmin } from './admin-client'

// ------------------------------------------------------------
// Automation-side sender.
//
// Thin wrapper over the channel layer's sendMessage(): the message goes
// out through the conversation's channel (WhatsApp, Messenger, ...) and
// is stored as a bot message. Kept as its own module so the engine's
// call sites and return shape don't change.
// ------------------------------------------------------------

interface SendTextArgs {
  workspaceId: string
  conversationId: string
  contactId: string
  text: string
}

interface SendTemplateArgs {
  workspaceId: string
  conversationId: string
  contactId: string
  templateName: string
  language?: string
  params?: string[]
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
  ids: { workspaceId: string; conversationId: string; contactId: string },
  content: OutboundContent,
): Promise<{ whatsapp_message_id: string }> {
  const db = supabaseAdmin()

  // Scope the contact / conversation lookups by workspace_id. The engine
  // uses the service-role client (bypassing RLS), and the public
  // /api/automations/engine endpoint accepts contact_id and
  // conversation_id from the request body — without these filters, an
  // authenticated member could fire their workspace's automations
  // against another tenant's contact. Cheap defense-in-depth.
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
    metadata: { source: 'automation' },
  })
  if (result.status === 'failed') {
    throw new Error(result.error || 'send failed')
  }
  return { whatsapp_message_id: result.externalId ?? '' }
}
