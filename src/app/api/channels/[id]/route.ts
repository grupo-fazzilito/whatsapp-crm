import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import type { Prisma } from '@/generated/prisma/client'
import { loadChannel, saveChannelSecrets } from '@/lib/channels/store'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { isUuid } from '@/lib/workspace/constants'
import { GRAPH, PUBLIC_SELECT, assertAgentInWorkspace, bad, skipVerify, str } from '../_lib/shared'
import { parseWebchatSettings, webchatHandle, type WebchatSettings } from '../_lib/webchat'
import { parseWelcomeMenu } from '../_lib/welcome-menu'
import type { WelcomeMenu } from '@/lib/ai/types'

/**
 * PATCH  /api/channels/[id] — admin. Any of:
 *   name, purpose, ai_agent_id (null = humans only), status ('connected'|'disconnected'),
 *   settings (shallow-merged; validated for webchat),
 *     settings.welcome_menu (any type; null removes it) — see _lib/welcome-menu.ts,
 *   access_token / verify_token / app_secret (rotate credentials; never returned;
 *   app_secret = own Meta app for manual setups, null removes it).
 * DELETE /api/channels/[id] — admin. Conversations keep their history
 *   (conversations.channel_id is set to NULL).
 */

type Params = { params: Promise<{ id: string }> }

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const wsId = guard.ctx.workspace.id
  if (!isUuid(id)) return bad('Not found', 404)

  const channel = await loadChannel(wsId, id)
  if (!channel) return bad('Not found', 404)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return bad('Invalid JSON body')

  const patch: Record<string, unknown> = {}

  if ('name' in body) {
    const name = str(body.name, 80)
    if (!name) return bad('name cannot be empty')
    patch.name = name
  }
  if ('purpose' in body) patch.purpose = str(body.purpose, 80)

  if ('ai_agent_id' in body) {
    const agentId = body.ai_agent_id === null || body.ai_agent_id === '' ? null : str(body.ai_agent_id, 64)
    if (agentId && !(await assertAgentInWorkspace(wsId, agentId))) {
      return bad('ai_agent_id does not belong to this workspace')
    }
    patch.ai_agent_id = agentId
  }

  if ('status' in body) {
    if (body.status !== 'connected' && body.status !== 'disconnected') {
      return bad("status must be 'connected' or 'disconnected'")
    }
    patch.status = body.status
    if (body.status === 'connected') patch.status_detail = null
  }

  if ('settings' in body) {
    if (!body.settings || typeof body.settings !== 'object' || Array.isArray(body.settings)) {
      return bad('settings must be an object')
    }
    const incoming = { ...(body.settings as Record<string, unknown>) }

    // Welcome menu (any channel type): validated on its own.
    let welcomeMenu: { value: WelcomeMenu | null } | null = null
    if ('welcome_menu' in incoming) {
      const parsed = parseWelcomeMenu(incoming.welcome_menu)
      if (!parsed.ok) return bad(parsed.error)
      const refError = await checkWelcomeMenuRefs(wsId, parsed.agentIds, parsed.assigneeIds)
      if (refError) return bad(refError)
      welcomeMenu = { value: parsed.menu }
      delete incoming.welcome_menu
    }

    let next: Record<string, unknown> = { ...channel.settings }
    if (channel.type === 'webchat') {
      const hasWidgetKeys = Object.keys(incoming).length > 0
      if (hasWidgetKeys || !welcomeMenu) {
        const parsed = parseWebchatSettings(incoming, channel.settings as Partial<WebchatSettings>)
        if (!parsed.ok) return bad(parsed.error)
        next = { ...next, ...parsed.settings }
        patch.display_handle = webchatHandle(parsed.settings)
      }
    } else {
      // Provider ids (page_id, waba_id...) are set at connect time; only
      // free-form extras may change here.
      delete incoming.page_id
      next = { ...next, ...incoming }
    }
    if (welcomeMenu) {
      if (welcomeMenu.value) next.welcome_menu = welcomeMenu.value
      else delete next.welcome_menu
    }
    patch.settings = next
  }

  // Credential rotation.
  const accessToken = str(body.access_token, 2000)
  const verifyToken = str(body.verify_token, 200)
  // Own Meta app (manual setup): its App Secret verifies that app's webhooks. null removes it.
  const appSecret = body.app_secret === null ? null : str(body.app_secret, 200)
  if ((appSecret || verifyToken) && (channel.type === 'webchat' || channel.type === 'tiktok')) return bad('This channel type has no Meta webhook credentials')
  if (accessToken && channel.type === 'webchat') return bad('webchat channels have no access token')
  if (accessToken && channel.type === 'whatsapp' && !skipVerify(request)) {
    try {
      const info = await verifyPhoneNumber({ phoneNumberId: channel.external_id, accessToken })
      patch.display_handle = info.display_phone_number ?? channel.display_handle
    } catch (err) {
      return bad(`Could not verify the new token with Meta: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }
  if (accessToken || verifyToken || 'app_secret' in body) {
    try {
      await saveChannelSecrets(id, {
        access_token: accessToken ?? undefined,
        verify_token: verifyToken ?? undefined,
        ...('app_secret' in body ? { app_secret: appSecret } : {}),
      })
    } catch (err) {
      return bad(err instanceof Error ? err.message : 'Could not save credentials', 500)
    }
    if (accessToken && !('status' in body)) {
      patch.status = 'connected'
      patch.status_detail = null
    }
  }

  if (Object.keys(patch).length === 0) {
    if (accessToken || verifyToken) {
      return NextResponse.json({ channel: stripSecrets(channel) })
    }
    return bad('Nothing to update')
  }

  try {
    const data = await guard.ctx.db.channels.update({
      where: { id, workspace_id: wsId },
      data: patch as Prisma.channelsUncheckedUpdateInput,
      select: PUBLIC_SELECT,
    })
    return NextResponse.json({ channel: data })
  } catch (error) {
    return bad(error instanceof Error ? error.message : 'Could not update the channel', 500)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const wsId = guard.ctx.workspace.id
  if (!isUuid(id)) return bad('Not found', 404)

  const channel = await loadChannel(wsId, id)
  if (!channel) return bad('Not found', 404)

  try {
    await guard.ctx.db.channels.deleteMany({ where: { id, workspace_id: wsId } })
  } catch (error) {
    return bad(error instanceof Error ? error.message : 'Could not delete the channel', 500)
  }

  // Stop Meta from sending us this page's events when nothing else uses it.
  const pageId = channel.type === 'messenger' ? channel.external_id : (channel.settings?.page_id as string | undefined)
  const token = channel.secrets.access_token
  if ((channel.type === 'messenger' || channel.type === 'instagram') && pageId && token) {
    // Every workspace: the page subscription is shared by all of them (platform-level check).
    const others = await prisma.channels
      .findMany({ select: { id: true, type: true, external_id: true, settings: true }, where: { type: { in: ['messenger', 'instagram'] } } })
      .catch(() => null)
    const stillUsed = (others ?? []).some(
      (c) => (c.type === 'messenger' ? c.external_id : (c.settings as Record<string, unknown>)?.page_id) === pageId,
    )
    if (!stillUsed) {
      await fetch(`${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps?access_token=${encodeURIComponent(token)}`, {
        method: 'DELETE',
      }).catch(() => null)
    }
  }

  return NextResponse.json({ ok: true })
}

/** Menu targets must be agents of this workspace and active members. */
async function checkWelcomeMenuRefs(wsId: string, agentIds: string[], assigneeIds: string[]): Promise<string | null> {
  const db = tenantDb(wsId)
  if (agentIds.length) {
    if (!agentIds.every(isUuid)) return 'welcome_menu: unknown AI agent'
    const data = await db.ai_agents.findMany({ select: { id: true }, where: { workspace_id: wsId, id: { in: agentIds } } })
    if (data.length !== agentIds.length) return 'welcome_menu: an option points to an AI agent that is not in this workspace'
  }
  if (assigneeIds.length) {
    if (!assigneeIds.every(isUuid)) return 'welcome_menu: unknown team member'
    const data = await db.workspace_members.findMany({
      select: { user_id: true },
      where: { workspace_id: wsId, status: 'active', user_id: { in: assigneeIds } },
    })
    if (data.length !== assigneeIds.length) return 'welcome_menu: an option assigns a person who is not an active member'
  }
  return null
}

function stripSecrets<T extends { secrets?: unknown }>(row: T): Omit<T, 'secrets'> {
  const { secrets: _secrets, ...rest } = row
  void _secrets
  return rest
}
