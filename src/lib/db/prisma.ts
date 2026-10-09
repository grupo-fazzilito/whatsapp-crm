import 'server-only'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

// One connection pool per process (dev reloads reuse it).
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')
  const adapter = new PrismaPg({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
  })
  return new PrismaClient({ adapter })
}

/**
 * Unscoped client: platform tasks only (crons, webhooks from providers,
 * auth, admin panel). Workspace code must use `tenantDb(workspaceId)`.
 */
export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient()
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
