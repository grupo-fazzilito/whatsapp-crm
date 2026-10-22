import 'server-only'
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api'
import { deleteSessionCookie, expireCookie, setSessionCookie } from 'better-auth/cookies'
import { prisma } from '@/lib/db/prisma'
import { isPlatformAdminUser } from '@/lib/admin/platform-admins'

// "Entrar como cliente": a platform admin opens a customer's account as that
// customer sees it. Same mechanism as Better Auth's admin plugin (a session
// for the customer marked impersonated_by, the admin's own session kept in a
// signed cookie to come back), with our own admin check. The customer sees
// no trace: the session doesn't count as their sign-in (see server.ts) and
// they get no notice. The visit is recorded in admin_impersonations, which
// only the admin panel shows.

export const IMPERSONATION_MINUTES = 60
const ADMIN_COOKIE = 'admin_session'

export function impersonation(): BetterAuthPlugin {
  return {
    id: 'whasalia-impersonation',
    endpoints: {
      impersonate: createAuthEndpoint('/whasalia/impersonate', { method: 'POST', requireHeaders: true }, async (ctx) => {
        const current = await getSessionFromCtx(ctx)
        if (!current) throw new APIError('UNAUTHORIZED')
        if (current.session.impersonatedBy) throw new APIError('BAD_REQUEST', { message: 'already_impersonating' })
        if (!(await isPlatformAdminUser({ id: current.user.id, email: current.user.email }))) throw new APIError('FORBIDDEN')

        const userId = typeof (ctx.body as { userId?: unknown })?.userId === 'string' ? (ctx.body as { userId: string }).userId : ''
        const target = userId ? await ctx.context.internalAdapter.findUserById(userId) : null
        if (!target) throw new APIError('NOT_FOUND', { message: 'user_not_found' })
        if (await isPlatformAdminUser({ id: target.id, email: target.email })) throw new APIError('FORBIDDEN', { message: 'target_is_admin' })

        const session = await ctx.context.internalAdapter.createSession(
          target.id,
          true,
          { impersonatedBy: current.user.id, expiresAt: new Date(Date.now() + IMPERSONATION_MINUTES * 60_000) },
          true,
        )
        if (!session) throw new APIError('INTERNAL_SERVER_ERROR')

        const member = await prisma.workspace_members.findFirst({
          where: { user_id: target.id, status: 'active' },
          orderBy: { created_at: 'asc' },
          select: { workspace_id: true, workspaces: { select: { name: true } } },
        })
        await prisma.admin_impersonations.create({
          data: {
            admin_user_id: current.user.id,
            admin_email: current.user.email,
            target_user_id: target.id,
            target_email: target.email,
            workspace_id: member?.workspace_id ?? null,
            workspace_name: member?.workspaces?.name ?? null,
            session_token: session.token,
            ip_address: session.ipAddress ?? null,
            user_agent: session.userAgent ?? null,
          },
        })

        // Keep the admin's own session to come back to.
        deleteSessionCookie(ctx)
        const adminCookie = ctx.context.createAuthCookie(ADMIN_COOKIE)
        await ctx.setSignedCookie(adminCookie.name, current.session.token, ctx.context.secret, ctx.context.authCookies.sessionToken.attributes)
        await setSessionCookie(ctx, { session, user: target }, true)
        return ctx.json({ ok: true })
      }),

      stopImpersonating: createAuthEndpoint('/whasalia/stop-impersonating', { method: 'POST', requireHeaders: true }, async (ctx) => {
        const current = await getSessionFromCtx(ctx)
        if (!current?.session.impersonatedBy) throw new APIError('BAD_REQUEST', { message: 'not_impersonating' })
        const adminCookie = ctx.context.createAuthCookie(ADMIN_COOKIE)
        const adminToken = await ctx.getSignedCookie(adminCookie.name, ctx.context.secret)
        const adminSession = adminToken ? await ctx.context.internalAdapter.findSession(adminToken) : null

        await ctx.context.internalAdapter.deleteSession(current.session.token)
        await prisma.admin_impersonations.updateMany({ where: { session_token: current.session.token, ended_at: null }, data: { ended_at: new Date() } })
        expireCookie(ctx, adminCookie)

        if (!adminSession || adminSession.session.userId !== current.session.impersonatedBy) {
          // The admin session ended meanwhile: sign in again in the panel.
          deleteSessionCookie(ctx)
          return ctx.json({ ok: true, signedOut: true })
        }
        await setSessionCookie(ctx, adminSession)
        return ctx.json({ ok: true, signedOut: false })
      }),
    },
  }
}
