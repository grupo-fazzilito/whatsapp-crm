import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { loadChannel } from '@/lib/channels/store'
import { isUuid } from '@/lib/workspace/constants'
import { refreshMarketingState } from '@/lib/whatsapp/marketing-server'
import { bad } from '../../_lib/shared'

/**
 * POST /api/channels/[id]/marketing — admin. Asks Meta again whether the
 * WhatsApp number can send marketing templates through the Marketing
 * Messages API (after the business accepts the terms in WhatsApp Manager).
 * → { marketing_messages: { status, checked_at } | null }
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  if (!isUuid(id)) return bad('Not found', 404)
  const channel = await loadChannel(guard.ctx.workspace.id, id)
  if (!channel || channel.type !== 'whatsapp') return bad('Not found', 404)
  if (typeof channel.settings?.waba_id !== 'string' || !channel.settings.waba_id) return bad('missing_waba', 400)
  const state = await refreshMarketingState(channel)
  return NextResponse.json({ marketing_messages: state })
}
