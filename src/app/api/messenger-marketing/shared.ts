import type { AdAccount } from '@/lib/messenger-marketing/graph'

// Page + ad account choices after Facebook Login, kept in an encrypted
// httpOnly cookie (never in the browser's JS) until the business confirms.
export const MM_COOKIE = 'mm_assets'
export const MM_COOKIE_PATH = '/api/messenger-marketing'
export const MM_TTL_MS = 15 * 60 * 1000

export interface MarketingCandidates {
  ws: string
  uid: string
  exp: number
  token: string
  pages: { id: string; name: string }[]
  adAccounts: AdAccount[]
}
