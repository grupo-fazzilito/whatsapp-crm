import 'server-only'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'
import { normalizeArgs } from './compat'
import { resultCompat } from './result-compat'

function createClient() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  })
  return new PrismaClient({ adapter })
    .$extends({
      name: 'args-compat',
      query: {
        $allModels: {
          // 'YYYY-MM-DD' strings for DATE columns, as the app sent them to PostgREST.
          async $allOperations({ model, args, query }) {
            return query(normalizeArgs(model, args) as typeof args)
          },
        },
      },
    })
    .$extends(resultCompat)
}

export type Db = ReturnType<typeof createClient>

// One connection pool per process (dev reloads reuse it).
const globalForPrisma = globalThis as unknown as { prisma?: Db }

/**
 * Unscoped client: platform tasks only (crons, webhooks from providers,
 * auth, admin panel). Workspace code must use `tenantDb(workspaceId)`.
 * Rows come back like PostgREST rows (see ./result-compat.ts).
 */
export const prisma: Db = globalForPrisma.prisma ?? createClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
