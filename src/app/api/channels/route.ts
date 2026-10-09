import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { verifyPhoneNumber } from '@/lib/whatsapp/meta-api'
import { tiktokEnabled } from '@/lib/channels/adapters/tiktok'
import { getMetaConfig, metaAppReady } from '@/lib/platform/meta'
import { CHANNEL_TYPES, type ChannelType } from '@/lib/channels/types'
import {
  CONFLICT_MESSAGE,
  PUBLIC_SELECT,
  assertAgentInWorkspace,
  bad,
  graphGet,
  skipVerify,
  str,
  subscribePage,
  subscribeWaba,
} from './_lib/shared'
import { insertChannel, type NewChannel } from './_lib/create'
import { newWidgetKey, parseWebchatSettings, webchatHandle } from './_lib/webchat'

/**
 * GET  /api/channels — channels of the active workspace (no secrets) plus
 *                      which connection methods this platform supports.
 * POST /api/channels — connect a channel (admin). Body depends on `type`:
 *   whatsapp  {name, purpose?, phone_number_id, waba_id?, access_token, verify_token?, app_secret?}
 *   messenger {name, purpose?, page_id, access_token, app_secret?}
 *   instagram {name, purpose?, instagram_id, page_id, access_token, app_secret?}
 * app_secret: only for businesses using THEIR OWN Meta app (manual setup) —
 * it verifies that app's webhook signatures. Stored encrypted, never returned.
 *   webchat   {name, purpose?, settings:{color,title,greeting,position,allowed_origins,prechat_fields}}
 *   tiktok    {name, purpose?, business_id, access_token}   (TIKTOK_MESSAGING_ENABLED=true only)
 * Optional on every type: ai_agent_id.
 * `?skip_verify=1` skips provider verification outside production (tests).
 */

export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  let data
  try {
    data = await db.channels.findMany({
      select: PUBLIC_SELECT,
      where: { workspace_id: workspace.id },
      orderBy: { created_at: 'asc' },
    })
  } catch (err) {
    return bad(err instanceof Error ? err.message : 'Failed to load channels', 500)
  }

  const meta = await getMetaConfig()
  return NextResponse.json({
    channels: data ?? [],
    features: {
      metaOAuth: metaAppReady(meta),
      /** WhatsApp Embedded Signup (Facebook Login for Business configuration set). */
      whatsappSignup: metaAppReady(meta) && !!meta.esConfigId,
      tiktok: tiktokEnabled(),
      platformVerifyToken: !!meta.verifyToken,
    },
  })
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return bad('Invalid JSON body')

  const type = body.type as ChannelType
  if (!CHANNEL_TYPES.includes(type)) return bad(`type must be one of: ${CHANNEL_TYPES.join(', ')}`)

  const name = str(body.name, 80)
  if (!name) return bad('name is required')
  const purpose = str(body.purpose, 80)

  const aiAgentId = str(body.ai_agent_id, 64)
  if (aiAgentId && !(await assertAgentInWorkspace(workspace.id, aiAgentId))) {
    return bad('ai_agent_id does not belong to this workspace')
  }

  const skip = skipVerify(request)
  const appSecret = str(body.app_secret, 200)
  if (appSecret && !/^[A-Za-z0-9]{16,128}$/.test(appSecret)) return bad('app_secret looks invalid (Meta → App settings → Basic → App secret)')
  const base = { workspaceId: workspace.id, userId: user.id, type, name, purpose, aiAgentId }
  let input: NewChannel
  /** Returned once so the admin can paste it into the Meta dashboard. */
  let verifyToken: string | null = null

  switch (type) {
    case 'whatsapp': {
      const phoneNumberId = str(body.phone_number_id, 64)
      const accessToken = str(body.access_token, 2000)
      const wabaId = str(body.waba_id, 64)
      if (!phoneNumberId || !accessToken) return bad('phone_number_id and access_token are required')
      if (!/^\d+$/.test(phoneNumberId)) return bad('phone_number_id must be numeric')

      let displayHandle: string | null = null
      let verifiedName: string | null = null
      if (!skip) {
        try {
          const info = await verifyPhoneNumber({ phoneNumberId, accessToken })
          displayHandle = info.display_phone_number ?? null
          verifiedName = info.verified_name ?? null
        } catch (err) {
          return bad(`Could not verify the number with Meta: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
      }
      verifyToken = str(body.verify_token, 200) ?? `vt_${crypto.randomBytes(16).toString('hex')}`

      let statusDetail: string | null = null
      if (wabaId && !skip) {
        const subErr = await subscribeWaba(wabaId, accessToken)
        if (subErr) statusDetail = `Webhook subscription failed: ${subErr}`
      }

      input = {
        ...base,
        externalId: phoneNumberId,
        displayHandle,
        statusDetail,
        settings: { waba_id: wabaId, verified_name: verifiedName },
        secrets: { access_token: accessToken, verify_token: verifyToken, app_secret: appSecret },
      }
      break
    }

    case 'messenger': {
      const pageId = str(body.page_id, 64)
      const accessToken = str(body.access_token, 2000)
      if (!pageId || !accessToken) return bad('page_id and access_token are required')

      let pageName: string | null = null
      let statusDetail: string | null = null
      if (!skip) {
        try {
          const page = await graphGet<{ id: string; name?: string }>(`${encodeURIComponent(pageId)}?fields=id,name`, accessToken)
          pageName = page.name ?? null
        } catch (err) {
          return bad(`Could not verify the page with Meta: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
        const subErr = await subscribePage(pageId, accessToken)
        if (subErr) statusDetail = `Webhook subscription failed: ${subErr}`
      }
      input = {
        ...base,
        externalId: pageId,
        displayHandle: pageName,
        statusDetail,
        settings: { page_id: pageId, page_name: pageName },
        secrets: { access_token: accessToken, app_secret: appSecret },
      }
      break
    }

    case 'instagram': {
      const igId = str(body.instagram_id, 64)
      const pageId = str(body.page_id, 64)
      const accessToken = str(body.access_token, 2000)
      if (!igId || !pageId || !accessToken) return bad('instagram_id, page_id and access_token are required')

      let username: string | null = null
      let statusDetail: string | null = null
      if (!skip) {
        try {
          const ig = await graphGet<{ id: string; username?: string }>(`${encodeURIComponent(igId)}?fields=id,username`, accessToken)
          username = ig.username ?? null
        } catch (err) {
          return bad(`Could not verify the Instagram account with Meta: ${err instanceof Error ? err.message : 'unknown error'}`)
        }
        const subErr = await subscribePage(pageId, accessToken)
        if (subErr) statusDetail = `Webhook subscription failed: ${subErr}`
      }
      input = {
        ...base,
        externalId: igId,
        displayHandle: username ? `@${username}` : null,
        statusDetail,
        settings: { page_id: pageId, username },
        secrets: { access_token: accessToken, app_secret: appSecret },
      }
      break
    }

    case 'webchat': {
      const parsed = parseWebchatSettings(body.settings, { title: name })
      if (!parsed.ok) return bad(parsed.error)
      input = {
        ...base,
        externalId: newWidgetKey(),
        displayHandle: webchatHandle(parsed.settings),
        settings: { ...parsed.settings },
      }
      break
    }

    case 'tiktok': {
      if (!tiktokEnabled()) {
        return bad(
          'TikTok messaging is not available yet: it requires approval from TikTok for the Business Messaging API (set TIKTOK_MESSAGING_ENABLED=true once approved).',
        )
      }
      const businessId = str(body.business_id, 128)
      const accessToken = str(body.access_token, 2000)
      if (!businessId || !accessToken) return bad('business_id and access_token are required')
      input = {
        ...base,
        externalId: businessId,
        displayHandle: str(body.handle, 80),
        settings: {},
        secrets: { access_token: accessToken },
      }
      break
    }
  }

  const result = await insertChannel(input)
  if (!result.ok) {
    return result.conflict ? bad(CONFLICT_MESSAGE, 409) : bad(result.error, 500)
  }
  return NextResponse.json(
    { channel: result.channel, ...(verifyToken ? { verify_token: verifyToken } : {}) },
    { status: 201 },
  )
}
