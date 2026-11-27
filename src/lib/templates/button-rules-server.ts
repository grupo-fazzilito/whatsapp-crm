import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { ruleForButton } from './button-rules'

/** How far back the template the customer is answering may be. */
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/**
 * The AI rule for a template button the customer just pressed: the last
 * template we sent in this conversation, and the rule of the button whose
 * text came back. Null when there is none (or on any error).
 */
export async function pressedButtonRule(workspaceId: string, conversationId: string, pressed: string): Promise<{ template: string; button: string; rule: string } | null> {
  try {
    const db = tenantDb(workspaceId)
    const sent = await db.messages.findFirst({
      select: { template_name: true },
      where: { conversation_id: conversationId, template_name: { not: null }, sender_type: { not: 'customer' }, created_at: { gte: new Date(Date.now() - WINDOW_MS) } },
      orderBy: { created_at: 'desc' },
    })
    if (!sent?.template_name) return null
    const templates = await db.message_templates.findMany({ select: { name: true, button_rules: true }, where: { name: sent.template_name } })
    for (const t of templates) {
      const hit = ruleForButton(t.button_rules, pressed)
      if (hit) return { template: t.name, ...hit }
    }
    return null
  } catch (err) {
    console.error('[templates] button rule lookup failed:', err instanceof Error ? err.message : err)
    return null
  }
}
