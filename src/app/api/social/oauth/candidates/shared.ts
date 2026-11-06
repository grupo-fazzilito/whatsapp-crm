import type { PageCandidate } from '@/lib/social/graph'

// Pages offered after Facebook Login, kept in an encrypted httpOnly cookie
// (never in the browser's JS, never in the DB) until the business picks one.
export const SOCIAL_COOKIE = 'social_pages'
export const SOCIAL_COOKIE_PATH = '/api/social/oauth'
export const SOCIAL_TTL_MS = 15 * 60 * 1000

export interface SocialCandidates {
  ws: string
  uid: string
  exp: number
  pages: PageCandidate[]
}
