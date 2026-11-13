import 'server-only'

// The platform's TikTok developer app (TikTok API for Business, "TikTok
// Accounts" scope). Environment variables:
//   TIKTOK_APP_ID, TIKTOK_APP_SECRET — My Apps > App Detail > Basic Information
//   TIKTOK_AUTH_URL — "TikTok account holder authorization URL" from the same page
//   TIKTOK_SANDBOX=true — local only: sample account, videos and comments, no
//     calls to TikTok (to demo the flow before the app is approved). Ignored in
//     production.

export interface TiktokAppConfig {
  appId: string
  appSecret: string
  authUrl: string
}

export function tiktokSandbox(): boolean {
  return process.env.TIKTOK_SANDBOX === 'true' && process.env.NODE_ENV !== 'production'
}

export function tiktokAppConfig(): TiktokAppConfig | null {
  const appId = process.env.TIKTOK_APP_ID?.trim()
  const appSecret = process.env.TIKTOK_APP_SECRET?.trim()
  const authUrl = process.env.TIKTOK_AUTH_URL?.trim()
  if (!appId || !appSecret || !authUrl) return null
  return { appId, appSecret, authUrl }
}

/** "Connect TikTok" works: the app is configured, or the local sandbox is on. */
export function tiktokConnectReady(): boolean {
  return tiktokSandbox() || !!tiktokAppConfig()
}
