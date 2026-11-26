// Free plan: one connected account per service (WhatsApp, Instagram, …).
// With the plan (or a courtesy set by a platform admin) accounts are
// unlimited. A business on the free plan with more than one account of a
// service keeps them for EXTRA_ACCOUNTS_GRACE_DAYS; then the extra ones are
// disconnected and only the main one stays: the first connected of each
// service. Pure — safe on the client.

export const FREE_ACCOUNTS_PER_SERVICE = 1
export const EXTRA_ACCOUNTS_GRACE_DAYS = 30

interface ChannelLike {
  id: string
  type: string
  created_at: string | Date | null
}

const time = (c: ChannelLike) => (c.created_at ? new Date(c.created_at).getTime() : Number.MAX_SAFE_INTEGER)

/** The main account of each service: the first one connected (oldest). */
export function mainChannelIds(channels: ChannelLike[]): Set<string> {
  const first = new Map<string, ChannelLike>()
  for (const c of channels) {
    const cur = first.get(c.type)
    if (!cur || time(c) < time(cur) || (time(c) === time(cur) && c.id < cur.id)) {
      first.set(c.type, c)
    }
  }
  return new Set([...first.values()].map((c) => c.id))
}

/** Accounts beyond the free allowance (everything but the main one of each service). */
export function extraChannelIds(channels: ChannelLike[]): string[] {
  const main = mainChannelIds(channels)
  return channels.filter((c) => !main.has(c.id)).map((c) => c.id)
}

/** When the extra accounts get disconnected, counting from when the business started having them. */
export function disconnectDate(since: string | Date | null): Date | null {
  if (!since) return null
  return new Date(new Date(since).getTime() + EXTRA_ACCOUNTS_GRACE_DAYS * 86_400_000)
}
