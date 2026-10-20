// Marketing Messages API for WhatsApp: marketing templates go through
// POST /{phone-number-id}/marketing_messages, where Meta optimizes delivery.
// Same numbers, templates and prices as Cloud API; each business accepts
// its terms once in WhatsApp Manager. From 2027-10-13 Cloud API refuses
// marketing templates, so this becomes the only way to send them.
// https://developers.facebook.com/documentation/business-messaging/whatsapp/marketing-messages/onboarding

/** Newer than the rest of the code's v21.0: the onboarding status field is recent. */
export const MM_GRAPH = 'https://graph.facebook.com/v24.0'

/** `marketing_messages_onboarding_status` of the WhatsApp Business Account. */
export type MarketingStatus = 'ONBOARDED' | 'ELIGIBLE' | 'NOT_ELIGIBLE' | 'UNKNOWN'

export interface MarketingState {
  status: MarketingStatus
  /** ISO time of the last check. */
  checked_at: string
}

/** What channels.settings.marketing_messages holds, if anything valid. */
export function readMarketingState(settings: Record<string, unknown> | null | undefined): MarketingState | null {
  const v = settings?.marketing_messages as Partial<MarketingState> | undefined
  if (!v || typeof v.status !== 'string' || typeof v.checked_at !== 'string') return null
  return { status: normalizeStatus(v.status), checked_at: v.checked_at }
}

export function normalizeStatus(raw: unknown): MarketingStatus {
  const s = typeof raw === 'string' ? raw.toUpperCase() : ''
  if (s === 'ONBOARDED' || s === 'ELIGIBLE') return s
  if (s.includes('NOT_ELIGIBLE') || s === 'INELIGIBLE') return 'NOT_ELIGIBLE'
  return 'UNKNOWN'
}

/** Marketing templates of an onboarded account go through the Marketing Messages API. */
export function usesMarketingApi(settings: Record<string, unknown> | null | undefined, category: string | null | undefined): boolean {
  return category?.toUpperCase() === 'MARKETING' && readMarketingState(settings)?.status === 'ONBOARDED'
}

/** Worth asking Meta again: never asked, or not onboarded yet and the answer is old. */
export function marketingStateStale(state: MarketingState | null, now = Date.now(), maxAgeMs = 6 * 3600_000): boolean {
  if (!state) return true
  if (state.status === 'ONBOARDED') return false
  return now - Date.parse(state.checked_at) > maxAgeMs
}

/** Asks Meta where the account stands. Throws on API errors. */
export async function fetchMarketingStatus(wabaId: string, accessToken: string): Promise<MarketingStatus> {
  const res = await fetch(`${MM_GRAPH}/${encodeURIComponent(wabaId)}?fields=marketing_messages_onboarding_status`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || data?.error) throw new Error(data?.error?.message ?? `Meta API error: ${res.status}`)
  return normalizeStatus(data.marketing_messages_onboarding_status)
}

/** WhatsApp Manager, where the business's admin accepts the terms. */
export function whatsappManagerUrl(wabaId: string | null | undefined): string {
  return wabaId
    ? `https://business.facebook.com/wa/manage/home/?waba_id=${encodeURIComponent(wabaId)}`
    : 'https://business.facebook.com/wa/manage/home/'
}

/** `account_update` webhook: WABA ids whose business just accepted the terms. */
export function parseMarketingTermsSigned(body: {
  object?: string
  entry?: { id: string; changes?: { field?: string; value?: { event?: string } }[] }[]
}): string[] {
  if (body.object !== 'whatsapp_business_account') return []
  const ids = new Set<string>()
  for (const entry of body.entry ?? []) {
    for (const c of entry.changes ?? []) {
      if (c.field === 'account_update' && (c.value?.event === 'MM_LITE_TERMS_SIGNED' || c.value?.event === 'AD_ACCOUNT_LINKED')) ids.add(entry.id)
    }
  }
  return [...ids]
}
