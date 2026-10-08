import { apiRoute, jsonBody } from '@/lib/public-api/http'
import { listMessages, sendConversationMessage } from '@/lib/public-api/conversations'

type P = { id: string }

/** GET /api/v1/conversations/{id}/messages?limit&cursor&created_since — newest first, internal notes excluded. */
export const GET = apiRoute<P>({ resource: 'conversations', access: 'read' }, ({ ctx, params, url }) => listMessages(ctx.workspace.id, params.id, url))

/** POST /api/v1/conversations/{id}/messages — text | media | template (WhatsApp). */
export const POST = apiRoute<P>(
  { resource: 'messages:send', access: 'write' },
  async ({ ctx, params, request }) => sendConversationMessage(ctx, params.id, await jsonBody(request)),
  { status: 201 },
)
