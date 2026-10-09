import { tenantDb } from '@/lib/db/tenant'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { clientIp, gateChannel, preflight, settingsOf, wcJson, webchatChannelByKey, withCors } from '@/lib/webchat/server'

const PRECHAT_FIELDS = ['name', 'email', 'phone']
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function OPTIONS(req: Request) {
  return preflight(req)
}

/** GET /api/webchat/config?key=pk_… → public widget settings. */
export async function GET(req: Request) {
  const rl = checkRateLimit(`wc:config:${clientIp(req)}`, { limit: 120, windowMs: 60_000 })
  if (!rl.success) return withCors(rateLimitResponse(rl), req)

  const key = new URL(req.url).searchParams.get('key')
  const channel = await webchatChannelByKey(key)
  const gate = gateChannel(req, channel)
  if (!gate.ok) return gate.response

  const s = settingsOf(channel!)
  const db = tenantDb(channel!.workspace_id)
  const [ws, agent] = await Promise.all([
    db.workspaces.findFirst({ select: { name: true, locale: true }, where: { id: channel!.workspace_id } }).catch(() => null),
    channel!.ai_agent_id
      ? db.ai_agents
          .findFirst({
            select: { greeting_message: true, language: true, enabled: true },
            where: { id: channel!.ai_agent_id, workspace_id: channel!.workspace_id },
          })
          .catch(() => null)
      : Promise.resolve(null),
  ])

  const greeting =
    (typeof s.greeting === 'string' && s.greeting.trim()) ||
    (agent?.enabled && agent.greeting_message) ||
    null

  return wcJson(
    {
      title: (typeof s.title === 'string' && s.title.trim()) || channel!.name,
      business_name: ws?.name ?? channel!.name,
      color: typeof s.color === 'string' && HEX.test(s.color) ? s.color : '#10b981',
      greeting,
      position: s.position === 'left' ? 'left' : 'right',
      prechat_fields: Array.isArray(s.prechat_fields)
        ? s.prechat_fields.filter((f) => PRECHAT_FIELDS.includes(f))
        : [],
      locale: ws?.locale ?? null,
    },
    200,
    gate.cors,
  )
}
