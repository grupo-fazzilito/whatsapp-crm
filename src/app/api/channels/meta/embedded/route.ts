import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getMetaConfig, metaAppReady } from '@/lib/platform/meta'
import {
  GraphError,
  PIN_RE,
  choosePhone,
  exchangeCode,
  isCoexistence,
  listWabaPhones,
  phoneInfo,
  randomPin,
  registerPhone,
  requestAppSync,
  subscribeApp,
  type GraphCtx,
  type OnboardingMode,
  type PhoneInfo,
} from '@/lib/whatsapp/embedded-signup'
import { CONFLICT_MESSAGE, PUBLIC_COLUMNS, assertAgentInWorkspace, bad, str } from '../../_lib/shared'
import { insertChannel } from '../../_lib/create'

/**
 * WhatsApp Embedded Signup (official Meta onboarding, Tech Provider).
 *
 * GET  /api/channels/meta/embedded — admin. Public values the browser needs
 *      to launch the flow with the Facebook JS SDK (app id, configuration
 *      ids, Graph version). Never secrets.
 * POST /api/channels/meta/embedded — admin.
 *      {code, waba_id, phone_number_id?, business_id?, mode: 'standard'|'coexistence',
 *       name?, purpose?, ai_agent_id?, pin?}
 *      Exchanges the code server-side, stores the business token encrypted,
 *      subscribes our app to the WABA, registers the number (standard path),
 *      creates the WhatsApp channel and, for WhatsApp Business app numbers
 *      (coexistence), requests the contacts + chat history sync.
 */

const ID_RE = /^\d{5,32}$/

export async function GET() {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const cfg = await getMetaConfig()
  const available = metaAppReady(cfg) && !!cfg.esConfigId
  return NextResponse.json({
    available,
    app_id: available ? cfg.appId : null,
    config_id: available ? cfg.esConfigId : null,
    coex_config_id: available ? cfg.esCoexConfigId ?? cfg.esConfigId : null,
    graph_version: cfg.graphVersion,
  })
}

function graphMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'unknown error'
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx

  const cfg = await getMetaConfig()
  if (!metaAppReady(cfg)) return bad('WhatsApp signup is not configured on this platform yet.', 503)

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return bad('Invalid JSON body')
  const code = str(body.code, 2000)
  const wabaId = str(body.waba_id, 32)
  const requestedPhone = str(body.phone_number_id, 32)
  const businessId = str(body.business_id, 32)
  const mode: OnboardingMode = body.mode === 'coexistence' ? 'coexistence' : 'standard'
  if (!code) return bad('code is required')
  if (!wabaId || !ID_RE.test(wabaId)) return bad('waba_id is required')
  if (requestedPhone && !ID_RE.test(requestedPhone)) return bad('phone_number_id must be numeric')
  const pinIn = str(body.pin, 6)
  if (pinIn && !PIN_RE.test(pinIn)) return bad('pin must be 6 digits')
  const purpose = str(body.purpose, 80)
  const aiAgentId = str(body.ai_agent_id, 64)
  if (aiAgentId && !(await assertAgentInWorkspace(workspace.id, aiAgentId))) {
    return bad('ai_agent_id does not belong to this workspace')
  }

  const ctx: GraphCtx = { base: cfg.graphBase }

  // 1) Code → business token (the code lives 30 seconds).
  let token: string
  try {
    token = await exchangeCode(ctx, { appId: cfg.appId!, appSecret: cfg.appSecret!, code })
  } catch (err) {
    console.error('[embedded-signup] code exchange failed:', graphMessage(err))
    return bad(`Meta rejected the authorization code (${graphMessage(err)}). Start the connection again.`, 502)
  }

  // Which number: the one the flow returned, else the WABA's first free one
  // (the Business app onboarding event may only carry the WABA id).
  let phones: PhoneInfo[] = []
  if (!requestedPhone) {
    try {
      phones = await listWabaPhones(ctx, wabaId, token)
    } catch (err) {
      return bad(`Could not read the WhatsApp account's numbers: ${graphMessage(err)}`, 502)
    }
  }
  const { data: taken } = await supabaseAdmin()
    .from('channels')
    .select('external_id')
    .eq('type', 'whatsapp')
    .in('external_id', phones.length ? phones.map((p) => p.id) : [requestedPhone ?? '0'])
  const takenIds = new Set((taken ?? []).map((r) => r.external_id as string))
  if (requestedPhone && takenIds.has(requestedPhone)) return bad(CONFLICT_MESSAGE, 409)
  const chosen = choosePhone(phones, requestedPhone, takenIds)
  if (!chosen) return bad(phones.length ? CONFLICT_MESSAGE : 'This WhatsApp account has no phone number yet.', phones.length ? 409 : 400)

  let info: PhoneInfo
  try {
    info = await phoneInfo(ctx, chosen.id, token)
  } catch (err) {
    return bad(`Could not read the number from Meta: ${graphMessage(err)}`, 502)
  }
  const coexistence = isCoexistence(mode, info)
  const warnings: string[] = []

  // 2) Webhooks for this WABA go to our app.
  try {
    await subscribeApp(ctx, wabaId, token)
  } catch (err) {
    warnings.push(`webhook_subscription: ${graphMessage(err)}`)
  }

  // 3) Register for Cloud API — never for Business app numbers (already registered).
  let pin: string | null = null
  let registerError: string | null = null
  if (!coexistence) {
    pin = pinIn ?? randomPin()
    try {
      await registerPhone(ctx, chosen.id, token, pin)
    } catch (err) {
      registerError = graphMessage(err)
      if (err instanceof GraphError) console.warn('[embedded-signup] register failed:', err.code, err.message)
    }
  }

  const display = info.display_phone_number ?? chosen.display_phone_number ?? null
  const verifiedName = info.verified_name ?? chosen.verified_name ?? null
  const name = str(body.name, 80) ?? (verifiedName ? `WhatsApp · ${verifiedName}` : 'WhatsApp').slice(0, 80)
  const statusDetail = registerError
    ? `Number registration failed: ${registerError}`
    : warnings.length
      ? `Webhook subscription failed: ${warnings[0].replace(/^webhook_subscription: /, '')}`
      : null

  const result = await insertChannel({
    workspaceId: workspace.id,
    userId: user.id,
    type: 'whatsapp',
    name,
    purpose,
    aiAgentId,
    externalId: chosen.id,
    displayHandle: display,
    status: registerError ? 'error' : 'connected',
    statusDetail,
    settings: {
      waba_id: wabaId,
      business_id: businessId,
      verified_name: verifiedName,
      connected_via: 'embedded_signup',
      onboarding_mode: coexistence ? 'coexistence' : 'standard',
      coexistence,
      onboarded_at: new Date().toISOString(),
    },
    secrets: { access_token: token, two_step_pin: pin },
  })
  if (!result.ok) {
    return result.conflict ? bad(CONFLICT_MESSAGE, 409) : bad(result.error, 500)
  }
  let channel = result.channel

  // 4) Coexistence: contacts + history sync must be requested within 24 h,
  //    once each. Messages arrive later through the webhook.
  if (coexistence) {
    const sync: Record<string, unknown> = { requested_at: new Date().toISOString() }
    for (const [key, type] of [
      ['contacts', 'smb_app_state_sync'],
      ['history', 'history'],
    ] as const) {
      try {
        sync[key] = { request_id: await requestAppSync(ctx, chosen.id, token, type) }
      } catch (err) {
        sync[key] = { error: graphMessage(err) }
        warnings.push(`${type}: ${graphMessage(err)}`)
      }
    }
    const { data } = await supabaseAdmin()
      .from('channels')
      .update({ settings: { ...channel.settings, coexistence_sync: sync } })
      .eq('id', channel.id)
      .eq('workspace_id', workspace.id)
      .select(PUBLIC_COLUMNS)
      .single()
    if (data) channel = data as unknown as typeof channel
  }

  return NextResponse.json({ channel, coexistence, warnings }, { status: 201 })
}
