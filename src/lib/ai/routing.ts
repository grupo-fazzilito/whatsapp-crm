import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import type { Prisma } from '@/generated/prisma/client'
import { sendMessage } from '@/lib/messaging/send'
import type { LoadedChannel, OutboundContent } from '@/lib/channels'
import { handOverToHuman, runAgent } from './engine'
import { matchTypedOption } from '@/lib/flows/options'
import type { AiAgentRow, ConversationAiState, WelcomeMenu, WelcomeMenuOption } from './types'

const MENU_PREFIX = 'menu:'
const MAX_MENU_ATTEMPTS = 2

export function welcomeMenuOf(channel: LoadedChannel): WelcomeMenu | null {
  const menu = channel.settings?.welcome_menu as WelcomeMenu | undefined
  if (!menu?.enabled || !menu.question?.trim() || !menu.options?.length) return null
  return menu
}

/** Which option the customer picked: tapped id, exact label, or its number. */
export function matchMenuOption(menu: WelcomeMenu, text: string, interactiveReplyId: string | null | undefined): WelcomeMenuOption | null {
  if (interactiveReplyId?.startsWith(MENU_PREFIX)) {
    const id = interactiveReplyId.slice(MENU_PREFIX.length)
    return menu.options.find((o) => o.id === id) ?? null
  }
  // "2", "opción 2", "dos", "la segunda", the label, or the label in a sentence.
  return matchTypedOption(menu.options.map((option) => ({ option, title: option.label })), text)?.option ?? null
}

async function sendMenu(workspaceId: string, conversationId: string, menu: WelcomeMenu) {
  const options = menu.options.map((o) => ({ id: `${MENU_PREFIX}${o.id}`, title: o.label, description: o.description }))
  // WhatsApp: up to 3 buttons, otherwise a list. Other channels adapt
  // (quick replies or a numbered menu) inside their adapters.
  const content: OutboundContent =
    options.length <= 3
      ? { type: 'buttons', text: menu.question, options: options.map((o) => ({ ...o, title: o.title.slice(0, 20) })) }
      : {
          type: 'list',
          text: menu.question,
          buttonLabel: (menu.button_label || 'Ver opciones').slice(0, 20),
          sections: [{ options: options.map((o) => ({ ...o, title: o.title.slice(0, 24) })) }],
        }
  await sendMessage({ workspaceId, conversationId, content, sender: { type: 'bot' }, metadata: { event: 'welcome_menu' } })
}

export interface RouteInput {
  workspaceId: string
  channel: LoadedChannel
  contactId: string
  conversationId: string
  messageText: string
  interactiveReplyId?: string | null
  contextMessageId?: string | null
  isFirstInboundMessage: boolean
  /** conversations.ai_agent_id */
  conversationAgentId: string | null
  aiState: ConversationAiState
}

async function loadAgent(workspaceId: string, id: string | null | undefined): Promise<AiAgentRow | null> {
  if (!id) return null
  const data = await tenantDb(workspaceId).ai_agents.findFirst({ where: { id, workspace_id: workspaceId } }).catch(() => null)
  return data?.enabled ? (data as unknown as AiAgentRow) : null
}

/**
 * Decides who answers an inbound message and runs it:
 *   conversation's agent → welcome menu → channel's agent.
 * Returns true when something replied (agent, menu, or handover).
 */
export async function routeInbound(input: RouteInput): Promise<boolean> {
  const ws = input.workspaceId
  const db = tenantDb(ws)
  // Failed writes were ignored with PostgREST's `{ error }`; keep it that way.
  const updateConversation = (data: Record<string, unknown>) =>
    db.conversations.updateMany({ where: { id: input.conversationId }, data: data as Prisma.conversationsUncheckedUpdateManyInput }).catch(() => undefined)
  const base = {
    workspaceId: ws,
    channel: input.channel,
    contactId: input.contactId,
    conversationId: input.conversationId,
    messageText: input.messageText,
    contextMessageId: input.contextMessageId,
    isFirstInboundMessage: input.isFirstInboundMessage,
  }

  // 1) An agent already owns this conversation (menu choice, transfer, flow).
  const pinned = await loadAgent(ws, input.conversationAgentId)
  if (pinned) return runAgent({ ...base, agent: pinned })

  // 2) Welcome menu of the channel.
  const menu = welcomeMenuOf(input.channel)
  if (menu) {
    if (input.aiState.menu_pending) {
      const choice = matchMenuOption(menu, input.messageText, input.interactiveReplyId)
      if (choice) {
        const state = { ...input.aiState, menu_pending: false, menu_attempts: 0 }
        if (choice.target.type === 'agent') {
          await updateConversation({ ai_agent_id: choice.target.agent_id, ai_state: state })
          const agent = await loadAgent(ws, choice.target.agent_id)
          if (agent) return runAgent({ ...base, agent, messageText: choice.label, isFirstInboundMessage: true })
        } else {
          await updateConversation({ ai_state: state })
          await sendMessage({
            workspaceId: ws,
            conversationId: input.conversationId,
            content: { type: 'text', text: '¡Gracias! Te comunico con una persona del equipo; en breve te responden. 🙏' },
            sender: { type: 'bot' },
          })
          await handOverToHuman(base, `Eligió "${choice.label}" en el menú de bienvenida`, choice.target.assignee_user_id ?? null)
          return true
        }
      } else if ((input.aiState.menu_attempts ?? 0) < MAX_MENU_ATTEMPTS) {
        await updateConversation({ ai_state: { ...input.aiState, menu_attempts: (input.aiState.menu_attempts ?? 0) + 1 } })
        await sendMenu(ws, input.conversationId, menu)
        return true
      } else {
        // Didn't pick after several tries: let the channel's agent take it.
        await updateConversation({ ai_state: { ...input.aiState, menu_pending: false } })
      }
    } else if (!input.aiState.menu_pending && input.aiState.menu_attempts === undefined) {
      await updateConversation({ ai_state: { ...input.aiState, menu_pending: true, menu_attempts: 0 } })
      await sendMenu(ws, input.conversationId, menu)
      return true
    }
  }

  // 3) Channel's default agent.
  const channelAgent = await loadAgent(ws, input.channel.ai_agent_id)
  if (channelAgent) return runAgent({ ...base, agent: channelAgent })
  return false
}
