import { apiRoute } from '@/lib/public-api/http'

/** GET /api/v1/me — the key's workspace and scopes (use it to test a connection). */
export const GET = apiRoute(null, async ({ ctx }) => ({
  data: {
    workspace: { id: ctx.workspace.id, name: ctx.workspace.name, industry: ctx.workspace.industry, currency: ctx.workspace.currency, timezone: ctx.workspace.timezone, locale: ctx.workspace.locale },
    api_key: { id: ctx.keyId, name: ctx.keyName, scopes: ctx.scopes },
  },
}))
