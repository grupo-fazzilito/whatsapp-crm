import 'server-only'

// Culqi (Peru) — official REST API, server side with the secret key.
//   POST /v2/customers   the business, once (Culqi asks for address, city, phone)
//   POST /v2/cards       a card token from Culqi Checkout saved on the customer
//   POST /v2/charges     charge the saved card (crd_…): no customer present
//   GET  /v2/charges/:id read a charge back
// The browser only ever sees the public key (Culqi Checkout turns the card
// into a token there); card data never reaches our server. Test and live are
// the same host; the key decides (sk_test_… / sk_live_…).

const API = 'https://api.culqi.com/v2'

export interface CulqiConfig {
  publicKey: string
  secretKey: string
}

/** Keys from the environment (CULQI_PUBLIC_KEY / CULQI_SECRET_KEY), or null when not set. */
export function culqiConfig(env: Record<string, string | undefined> = process.env): CulqiConfig | null {
  const publicKey = env.CULQI_PUBLIC_KEY?.trim()
  const secretKey = env.CULQI_SECRET_KEY?.trim()
  if (!publicKey || !secretKey || !/^pk_(test|live)_/.test(publicKey) || !/^sk_(test|live)_/.test(secretKey)) return null
  return { publicKey, secretKey }
}

export class CulqiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Culqi's `type` / `code` / `decline_code`, e.g. card_error / card_declined / insufficient_funds. */
    readonly type: string | null = null,
    readonly code: string | null = null,
    readonly declineCode: string | null = null,
    /** Message meant for the customer (Spanish). */
    readonly userMessage: string | null = null,
  ) {
    super(message)
    this.name = 'CulqiError'
  }
}

async function call<T>(cfg: CulqiConfig, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>): Promise<{ data: T; status: number }> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${cfg.secretKey}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  const data = (await res.json().catch(() => ({}))) as T & {
    object?: string
    type?: string
    code?: string
    decline_code?: string
    merchant_message?: string
    user_message?: string
  }
  if (!res.ok || data.object === 'error') {
    throw new CulqiError(data.merchant_message ?? `Culqi API error: ${res.status}`, res.status, data.type ?? null, data.code ?? null, data.decline_code ?? null, data.user_message ?? null)
  }
  return { data, status: res.status }
}

export interface CulqiCustomerInput {
  firstName: string
  lastName: string
  email: string
  address: string
  city: string
  phone: string
}

/** The customer fields Culqi asks for, trimmed to conservative lengths (names without digits or symbols). */
export function customerPayload(c: CulqiCustomerInput): Record<string, unknown> {
  const clip = (s: string, max: number) => s.replace(/\s+/g, ' ').trim().slice(0, max)
  const name = (s: string) => clip(s.replace(/[^\p{L}\s'-]/gu, ' '), 50) || 'Cliente'
  return {
    first_name: name(c.firstName),
    last_name: name(c.lastName),
    email: clip(c.email, 50),
    address: clip(c.address, 100),
    address_city: clip(c.city, 30),
    country_code: 'PE',
    phone_number: c.phone.replace(/\D/g, '').slice(-9),
  }
}

/** The Culqi customer with this email (Culqi allows one per email), or null. */
export async function findCustomerByEmail(cfg: CulqiConfig, email: string): Promise<{ id: string } | null> {
  const { data } = await call<{ data?: { id: string; email?: string }[] }>(cfg, 'GET', `/customers?email=${encodeURIComponent(email.trim().toLowerCase())}`)
  return data.data?.find((c) => c.email?.toLowerCase() === email.trim().toLowerCase()) ?? null
}

/** A Culqi customer for the business: the existing one with this email, or a new one. */
export async function createCustomer(cfg: CulqiConfig, input: CulqiCustomerInput): Promise<{ id: string }> {
  const existing = await findCustomerByEmail(cfg, input.email)
  if (existing) return existing
  return (await call<{ id: string }>(cfg, 'POST', '/customers', customerPayload(input))).data
}

export interface CulqiCard {
  id: string
  active?: boolean
  source?: { last_four?: string; card_number?: string; iin?: { card_brand?: string } }
}

export async function createCard(cfg: CulqiConfig, customerId: string, tokenId: string): Promise<CulqiCard> {
  if (!/^tkn_(test|live)_[A-Za-z0-9]+$/.test(tokenId)) throw new CulqiError('Invalid card token', 400, 'invalid_request_error', 'invalid_token')
  return (await call<CulqiCard>(cfg, 'POST', '/cards', { customer_id: customerId, token_id: tokenId })).data
}

/** "Visa •••• 1111" */
export function cardLabel(card: CulqiCard): string {
  const brand = card.source?.iin?.card_brand ?? ''
  const last = card.source?.last_four ?? card.source?.card_number?.slice(-4) ?? ''
  return `${brand} •••• ${last}`.trim()
}

export interface CulqiCharge {
  id: string
  amount: number
  currency_code: string
  paid?: boolean
  reference_code?: string
  outcome?: { type?: string; code?: string; merchant_message?: string; user_message?: string }
}

/**
 * Charges a saved card. Approved = HTTP 201 with outcome.type 'venta_exitosa'
 * (Culqi's `paid` stays false until the money settles, so it isn't used).
 * Anything else (a 3D Secure challenge included: we don't run one) is a failure.
 */
export async function chargeCard(
  cfg: CulqiConfig,
  input: { cardId: string; amountCents: number; currency: 'PEN' | 'USD'; email: string; description: string; metadata: Record<string, string> },
): Promise<CulqiCharge> {
  const { data, status } = await call<CulqiCharge>(cfg, 'POST', '/charges', {
    amount: input.amountCents,
    currency_code: input.currency,
    email: input.email,
    source_id: input.cardId,
    // Culqi limits the description to 80 characters.
    description: input.description.slice(0, 80),
    metadata: input.metadata,
  })
  if (status !== 201 || data.outcome?.type !== 'venta_exitosa') {
    throw new CulqiError(data.outcome?.merchant_message ?? 'The charge needs a verification we do not support (3D Secure)', status, 'card_error', 'needs_3ds', null, data.outcome?.user_message ?? null)
  }
  return data
}
