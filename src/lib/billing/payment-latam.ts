import crypto from 'node:crypto'

// Payment Latam API (Payin only — the platform collects top-ups).
// Manual: "Manual de Integración API — Payin · Payout · Reportes · Webhooks".
//   POST /api/Auth/generaToken                  → { token, errorMensaje }
//   POST /ServicioPayin/ingresaOrdenRecaudo      (Bearer) → { codigo, errorMensaje, result: { estado, monto, ordenID, referencia, checkout } }
//   POST /ServicioPayin/consulta-recaudo         (Bearer) → same result
// Payin checksum = SHA512(secretUser + secretPass + codigo_merchant + documento + email + importe).
// Webhooks are NOT signed: callers must re-check the order with
// consulta-recaudo before trusting a state.

export const DEFAULT_PL_BASE_URL = 'https://pay-met.pe:8093'

/** How `importe` is written, both in the checksum and in the JSON body. */
export type AmountFormat = 'fixed2' | 'fixed1' | 'plain'

export interface PaymentLatamConfig {
  baseUrl: string
  merchantCode: string
  secretUser: string
  secretPass: string
  amountFormat: AmountFormat
}

export type PayinState = 'PENDIENTE' | 'APROBADA' | 'VENCIDA' | 'EXTORNO' | string

export interface PayinResult {
  estado: PayinState
  monto: number | null
  ordenID: string
  referencia: string | null
  checkout: string | null
}

export class PaymentLatamError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
    this.name = 'PaymentLatamError'
  }
}

export function formatAmount(amount: number, format: AmountFormat): string {
  if (format === 'fixed2') return amount.toFixed(2)
  if (format === 'fixed1') return amount.toFixed(1)
  return String(amount)
}

export function payinChecksum(cfg: Pick<PaymentLatamConfig, 'secretUser' | 'secretPass' | 'merchantCode'>, documento: string, email: string, importe: string): string {
  return crypto
    .createHash('sha512')
    .update(cfg.secretUser + cfg.secretPass + cfg.merchantCode + documento + email + importe, 'utf8')
    .digest('hex')
}

/** "José Pérez-Ñúñez & Cía." → "JOSE PEREZ NUNEZ CIA" (no accents or special characters). */
export function plainName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
    .slice(0, 200)
}

/** Expiry date (yyyy-MM-dd, Lima) `days` from now; the API allows today … +30 days. */
export function expiryDate(days: number, now = new Date()): string {
  const d = new Date(now.getTime() + Math.min(Math.max(days, 0), 30) * 86_400_000)
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

export interface PayinInput {
  docType: number
  document: string
  name: string
  email: string
  amount: number
  expiresOn: string
  webhookUrl?: string
}

/**
 * JSON body for ingresaOrdenRecaudo. Written by hand so `importe` keeps the
 * exact text used in the checksum (JSON.stringify would turn 50.00 into 50).
 */
export function payinBody(cfg: PaymentLatamConfig, input: PayinInput): string {
  const importe = formatAmount(input.amount, cfg.amountFormat)
  const email = input.email.trim()
  const documento = input.document.trim()
  const fields: [string, string][] = [
    ['codigoMerchant', JSON.stringify(cfg.merchantCode)],
    ['fecha_caduca', JSON.stringify(input.expiresOn)],
    ['idtipodocumento', String(input.docType)],
    ['documento', JSON.stringify(documento)],
    ['nombres', JSON.stringify(plainName(input.name))],
    ['email', JSON.stringify(email)],
    ['importe', importe],
    ['checksum', JSON.stringify(payinChecksum(cfg, documento, email, importe))],
  ]
  if (input.webhookUrl) fields.push(['urlWebhook', JSON.stringify(input.webhookUrl)])
  return `{${fields.map(([k, v]) => `${JSON.stringify(k)}:${v}`).join(',')}}`
}

function toResult(r: Record<string, unknown> | undefined | null): PayinResult | null {
  if (!r) return null
  const ordenID = r.ordenID ?? r.OrdenID ?? r.ordenId
  if (ordenID === undefined || ordenID === null || ordenID === '') return null
  const monto = Number(r.monto ?? r.Monto)
  return {
    estado: String(r.estado ?? r.Estado ?? '').toUpperCase(),
    monto: Number.isFinite(monto) ? monto : null,
    ordenID: String(ordenID),
    referencia: r.referencia != null || r.Referencia != null ? String(r.referencia ?? r.Referencia) : null,
    checkout: typeof (r.checkout ?? r.Checkout) === 'string' ? String(r.checkout ?? r.Checkout) : null,
  }
}

/** Webhook payload (PascalCase fields) → the order it talks about. */
export function parsePayinWebhook(body: unknown): PayinResult | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  return toResult(body as Record<string, unknown>)
}

// ------------------------------------------------------------
// HTTP client
// ------------------------------------------------------------
const tokens = new Map<string, { token: string; at: number }>()
const TOKEN_TTL_MS = 4 * 60_000

function tokenKey(cfg: PaymentLatamConfig) {
  return crypto.createHash('sha256').update(`${cfg.baseUrl}|${cfg.merchantCode}|${cfg.secretUser}|${cfg.secretPass}`).digest('hex')
}

async function post(cfg: PaymentLatamConfig, path: string, body: string, token?: string): Promise<{ status: number; json: unknown }> {
  let res: Response
  try {
    res = await fetch(cfg.baseUrl.replace(/\/+$/, '') + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body,
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
    })
  } catch (err) {
    throw new PaymentLatamError(`network: ${err instanceof Error ? err.message : String(err)}`)
  }
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 500) }
  }
  return { status: res.status, json }
}

export async function generateToken(cfg: PaymentLatamConfig, fresh = false): Promise<string> {
  const key = tokenKey(cfg)
  const hit = tokens.get(key)
  if (!fresh && hit && Date.now() - hit.at < TOKEN_TTL_MS) return hit.token
  const { status, json } = await post(
    cfg,
    '/api/Auth/generaToken',
    JSON.stringify({ secretUser: cfg.secretUser, secretPass: cfg.secretPass, codigo_merchant: cfg.merchantCode }),
  )
  const j = (json ?? {}) as { token?: string; errorMensaje?: string }
  if (!j.token) throw new PaymentLatamError(j.errorMensaje || `token failed (HTTP ${status})`, status)
  tokens.set(key, { token: j.token, at: Date.now() })
  return j.token
}

/** Authenticated call; a 401 regenerates the token once. */
async function authed(cfg: PaymentLatamConfig, path: string, body: string) {
  let r = await post(cfg, path, body, await generateToken(cfg))
  if (r.status === 401) r = await post(cfg, path, body, await generateToken(cfg, true))
  return r
}

function unwrap(status: number, json: unknown): PayinResult {
  const j = (json ?? {}) as { codigo?: string; errorMensaje?: string; result?: Record<string, unknown> }
  if (status >= 400 || String(j.codigo ?? '').toUpperCase() !== 'OK') {
    throw new PaymentLatamError(j.errorMensaje || `HTTP ${status}`, status)
  }
  const r = toResult(j.result)
  if (!r) throw new PaymentLatamError('respuesta sin ordenID', status)
  return r
}

export async function createPayin(cfg: PaymentLatamConfig, input: PayinInput): Promise<PayinResult> {
  const { status, json } = await authed(cfg, '/ServicioPayin/ingresaOrdenRecaudo', payinBody(cfg, input))
  return unwrap(status, json)
}

export async function queryPayin(cfg: PaymentLatamConfig, orderId: string): Promise<PayinResult> {
  const { status, json } = await authed(cfg, '/ServicioPayin/consulta-recaudo', JSON.stringify({ codigo_merchant: cfg.merchantCode, OrdenID: orderId }))
  return unwrap(status, json)
}
