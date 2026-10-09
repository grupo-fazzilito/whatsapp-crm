import crypto from 'node:crypto'

// Server-side steps of WhatsApp Embedded Signup (Tech Provider flow):
//   1. exchange the code for a business token (30 s TTL on the code)
//   2. subscribe our app to the customer's WABA webhooks
//   3. register the number for Cloud API (NOT for WhatsApp Business app
//      numbers — coexistence numbers are already registered)
//   4. coexistence only: request contacts + history sync (once, ≤24 h)
// https://developers.facebook.com/docs/whatsapp/embedded-signup/onboarding-customers-as-a-tech-provider
// https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users
// All calls are server-to-server; `base` is https://graph.facebook.com/<version>
// (or a local mock outside production).

export type OnboardingMode = 'standard' | 'coexistence'

export interface GraphCtx {
  base: string
  fetch?: typeof fetch
}

export class GraphError extends Error {
  constructor(
    message: string,
    readonly code: number | null = null,
    readonly status: number | null = null,
  ) {
    super(message)
  }
}

async function call<T>(ctx: GraphCtx, path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, ...rest } = init
  const res = await (ctx.fetch ?? fetch)(`${ctx.base}/${path}`, {
    cache: 'no-store',
    ...rest,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(rest.body ? { 'Content-Type': 'application/json' } : {}),
      ...(rest.headers ?? {}),
    },
  })
  const text = await res.text()
  let data: Record<string, unknown> = {}
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // The token endpoint historically could answer as plain text.
    data = { raw: text }
  }
  const err = data.error as { message?: string; code?: number; error_user_msg?: string } | undefined
  if (!res.ok || err) {
    throw new GraphError(err?.error_user_msg || err?.message || `Meta API error ${res.status}`, err?.code ?? null, res.status)
  }
  return data as T
}

/** Step 1 — code from FB.login → business integration system user token. */
export async function exchangeCode(ctx: GraphCtx, args: { appId: string; appSecret: string; code: string }): Promise<string> {
  const qs = new URLSearchParams({ client_id: args.appId, client_secret: args.appSecret, code: args.code })
  const data = await call<{ access_token?: string; raw?: string }>(ctx, `oauth/access_token?${qs}`)
  const token = data.access_token ?? (data.raw && /^access_token=/.test(data.raw) ? new URLSearchParams(data.raw).get('access_token') : null)
  if (!token) throw new GraphError('Meta did not return an access token')
  return token
}

export interface PhoneInfo {
  id: string
  display_phone_number?: string
  verified_name?: string
  quality_rating?: string
  code_verification_status?: string
  is_on_biz_app?: boolean
  platform_type?: string
}

export async function listWabaPhones(ctx: GraphCtx, wabaId: string, token: string): Promise<PhoneInfo[]> {
  const data = await call<{ data?: PhoneInfo[] }>(
    ctx,
    `${encodeURIComponent(wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`,
    { token },
  )
  return data.data ?? []
}

export async function phoneInfo(ctx: GraphCtx, phoneNumberId: string, token: string): Promise<PhoneInfo> {
  try {
    return await call<PhoneInfo>(
      ctx,
      `${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating,code_verification_status,is_on_biz_app,platform_type`,
      { token },
    )
  } catch (err) {
    // Older API versions may not know the coexistence fields: retry without them.
    if (err instanceof GraphError && err.code === 100) {
      return call<PhoneInfo>(ctx, `${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`, { token })
    }
    throw err
  }
}

/** Step 2 — POST /<WABA_ID>/subscribed_apps. */
export async function subscribeApp(ctx: GraphCtx, wabaId: string, token: string): Promise<void> {
  await call(ctx, `${encodeURIComponent(wabaId)}/subscribed_apps`, { method: 'POST', token })
}

/** Step 3 — POST /<PHONE_NUMBER_ID>/register; the PIN becomes the number's two-step verification PIN. */
export async function registerPhone(ctx: GraphCtx, phoneNumberId: string, token: string, pin: string): Promise<void> {
  await call(ctx, `${encodeURIComponent(phoneNumberId)}/register`, {
    method: 'POST',
    token,
    body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
  })
}

/** Step 4 (coexistence) — POST /<PHONE_NUMBER_ID>/smb_app_data. One request per sync type, ever. */
export async function requestAppSync(
  ctx: GraphCtx,
  phoneNumberId: string,
  token: string,
  syncType: 'smb_app_state_sync' | 'history',
): Promise<string | null> {
  const data = await call<{ request_id?: string }>(ctx, `${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
    method: 'POST',
    token,
    body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
  })
  return data.request_id ?? null
}

export function randomPin(): string {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
}

export const PIN_RE = /^\d{6}$/

/** A WABA can hold several numbers: the one the flow returned, else the first not yet connected. */
export function choosePhone(phones: PhoneInfo[], requested: string | null, taken: Set<string>): PhoneInfo | null {
  if (requested) return phones.find((p) => p.id === requested) ?? { id: requested }
  return phones.find((p) => !taken.has(p.id)) ?? null
}

/** Coexistence when the user picked that path or Meta reports the number lives on the Business app. */
export function isCoexistence(mode: OnboardingMode, info: Pick<PhoneInfo, 'is_on_biz_app'> | null): boolean {
  return mode === 'coexistence' || info?.is_on_biz_app === true
}
