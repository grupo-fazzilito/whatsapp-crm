import 'server-only'
import { NextResponse } from 'next/server'
import { requireWorkspace, type WorkspaceContext } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { LlmUnavailableError } from '@/lib/ai/llm'
import { AssistError } from './service'

/** Per-user budgets for the inbox AI actions. */
export const ASSIST_LIMITS = {
  media: { limit: 20, windowMs: 60_000 },
  summary: { limit: 10, windowMs: 60_000 },
  suggest: { limit: 20, windowMs: 60_000 },
} as const

type Guarded = { ok: true; ctx: WorkspaceContext } | { ok: false; response: NextResponse }

/** Member of the active workspace, within the per-user budget for `bucket`. */
export async function assistGuard(bucket: keyof typeof ASSIST_LIMITS): Promise<Guarded> {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard
  const rl = checkRateLimit(`ai-assist:${bucket}:${guard.ctx.user.id}`, ASSIST_LIMITS[bucket])
  if (!rl.success) return { ok: false, response: rateLimitResponse(rl) }
  return guard
}

/** The caller can see this message (RLS) in the active workspace. */
export async function visibleMessage(ctx: WorkspaceContext, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const data = await ctx.db.messages.findFirst({ select: { id: true }, where: { id, workspace_id: ctx.workspace.id } })
  return !!data
}

/** The caller can see this conversation (RLS) in the active workspace. */
export async function visibleConversation(ctx: WorkspaceContext, id: string): Promise<boolean> {
  if (!isUuid(id)) return false
  const data = await ctx.db.conversations.findFirst({ select: { id: true }, where: { id, workspace_id: ctx.workspace.id } })
  return !!data
}

const STATUS: Record<AssistError['code'], number> = {
  not_found: 404,
  not_media: 400,
  no_provider: 409,
  no_credits: 402,
  too_large: 413,
  unsupported_type: 415,
  media_unavailable: 502,
  empty: 422,
  failed: 502,
}

/** JSON error with a stable `code` the UI translates. */
export function assistErrorResponse(err: unknown): NextResponse {
  if (err instanceof AssistError) {
    if (err.code === 'failed' || err.code === 'media_unavailable') console.warn('[ai-assist]', err.code, err.message.slice(0, 300))
    return NextResponse.json({ error: err.code, code: err.code }, { status: STATUS[err.code] })
  }
  if (err instanceof LlmUnavailableError) {
    const none = /No AI provider configured/.test(err.message)
    console.warn('[ai-assist] text model unavailable:', err.message.slice(0, 300))
    return NextResponse.json({ error: none ? 'no_text_provider' : 'failed', code: none ? 'no_text_provider' : 'failed' }, { status: none ? 409 : 502 })
  }
  console.error('[ai-assist] unexpected error:', err)
  return NextResponse.json({ error: 'failed', code: 'failed' }, { status: 500 })
}
