import 'server-only'
import { randomUUID } from 'node:crypto'
import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { nextCookies } from 'better-auth/next-js'
import { baseClient } from '@/lib/db/prisma'
import { hashPassword, verifyPassword } from './password'

// Better Auth on our own tables (public.users / auth_sessions / auth_accounts /
// auth_verifications, snake_case columns mapped below). Email + password, plus
// Google / Facebook sign-in when their keys are set. Signup OTP and
// password-reset OTP stay in /api/auth/*-otp.

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET
  if (s) return s
  if (process.env.NODE_ENV === 'production') throw new Error('BETTER_AUTH_SECRET is not set')
  return `dev-only:${process.env.ENCRYPTION_KEY ?? 'insecure'}`
}

type AuthInstance = ReturnType<typeof createAuth>

export type SocialProvider = 'google' | 'facebook'

function socialCredentials() {
  const env = process.env
  // Facebook sign-in can reuse the platform's Meta app.
  const fbId = env.FACEBOOK_CLIENT_ID || env.META_APP_ID
  const fbSecret = env.FACEBOOK_CLIENT_SECRET || env.META_APP_SECRET
  return {
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET } } : {}),
    ...(fbId && fbSecret ? { facebook: { clientId: fbId, clientSecret: fbSecret } } : {}),
  }
}

/** Social sign-in buttons to show (providers with keys configured). */
export function socialProviders(): SocialProvider[] {
  return Object.keys(socialCredentials()) as SocialProvider[]
}

function localeFromCookie(cookie: string | null | undefined): 'es' | 'en' {
  return /(?:^|;\s*)locale=en(?:;|$)/.test(cookie ?? '') ? 'en' : 'es'
}

function createAuth() {
  return betterAuth({
    appName: 'Whasalia',
    baseURL: process.env.BETTER_AUTH_URL || process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001',
    secret: secret(),
    database: prismaAdapter(baseClient(), { provider: 'postgresql' }),
    telemetry: { enabled: false },
    socialProviders: socialCredentials(),
    emailAndPassword: {
      enabled: true,
      // Accounts are created by /api/auth/register-otp after the email code is verified.
      disableSignUp: true,
      minPasswordLength: 6,
      maxPasswordLength: 128,
      password: { hash: hashPassword, verify: verifyPassword },
    },
    session: {
      modelName: 'auth_sessions',
      fields: { userId: 'user_id', expiresAt: 'expires_at', ipAddress: 'ip_address', userAgent: 'user_agent', createdAt: 'created_at', updatedAt: 'updated_at' },
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      cookieCache: { enabled: true, maxAge: 60 },
    },
    user: {
      modelName: 'users',
      fields: { emailVerified: 'email_verified', createdAt: 'created_at', updatedAt: 'updated_at' },
      // Signup data read by the users trigger (handle_new_user).
      additionalFields: { meta: { type: 'json', required: false, input: false } },
    },
    account: {
      modelName: 'auth_accounts',
      // Google and Facebook only share verified emails: signing in with one
      // links to the existing account with that email.
      accountLinking: { enabled: true, trustedProviders: ['google', 'facebook'] },
      // We never call Google/Facebook with these tokens; keep them encrypted at rest.
      encryptOAuthTokens: true,
      fields: {
        userId: 'user_id',
        accountId: 'account_id',
        providerId: 'provider_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    verification: {
      modelName: 'auth_verifications',
      fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
    },
    advanced: {
      database: { generateId: () => randomUUID() },
      cookiePrefix: 'cnx',
    },
    databaseHooks: {
      user: {
        create: {
          // Only social sign-in creates users through Better Auth (email
          // signup goes through /api/auth/register-otp). No workspace yet:
          // /welcome asks for the business details and creates it.
          before: async (user, ctx) => ({
            data: { ...user, meta: { full_name: user.name ?? '', invite: true, social: true, locale: localeFromCookie(ctx?.headers?.get('cookie')) } },
          }),
        },
      },
      session: {
        create: {
          // Banned users cannot start a session.
          before: async (session) => {
            const user = await baseClient().users.findUnique({ where: { id: session.userId }, select: { banned: true } })
            if (!user || user.banned) return false
          },
          after: async (session) => {
            await baseClient()
              .users.update({ where: { id: session.userId }, data: { last_sign_in_at: new Date() } })
              .catch(() => {})
          },
        },
      },
    },
    plugins: [nextCookies()],
  })
}

const g = globalThis as unknown as { betterAuth?: AuthInstance }

/** The Better Auth instance (created on first use). */
export function auth(): AuthInstance {
  if (!g.betterAuth) g.betterAuth = createAuth()
  return g.betterAuth
}
