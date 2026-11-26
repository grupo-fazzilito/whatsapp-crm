// Client-safe: which TikTok permissions a connection was granted (the
// comma-separated `scope` of the token response, kept in channel.settings.scopes).

/** Business Messaging API: read the inbox and send replies. */
export const TIKTOK_MESSAGE_SCOPES = ['message.list.read', 'message.list.send'] as const

/** The account was authorized for direct messages (connections made before that approval weren't). */
export function tiktokCanMessage(scopes: readonly string[] | null | undefined): boolean {
  const granted = new Set((scopes ?? []).map((s) => s.trim()))
  return granted.has('message.list.manage') || TIKTOK_MESSAGE_SCOPES.every((s) => granted.has(s))
}
