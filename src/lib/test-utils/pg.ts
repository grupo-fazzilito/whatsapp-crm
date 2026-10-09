// Helpers for tests that run against a real PostgreSQL with the baseline
// schema (TEST_DATABASE_URL, e.g. the docker-compose.postgres.yml database).
// Usage in a test file:
//   vi.mock('server-only', () => ({}))
//   const pg = await pgTest()           // null → describe.skipIf
import { randomUUID } from 'node:crypto'

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL

export async function pgTest() {
  if (!TEST_DATABASE_URL) return null
  process.env.DATABASE_URL = TEST_DATABASE_URL
  const { prisma } = await import('@/lib/db/prisma')
  const { tenantDb } = await import('@/lib/db/tenant')

  /** New user + workspace through the signup trigger. */
  async function workspace(opts: { businessType?: string; name?: string } = {}) {
    const email = `t-${randomUUID()}@test.local`
    const user = await prisma.users.create({
      data: { email, meta: { full_name: 'Test', business_name: opts.name ?? 'Test Biz', business_type: opts.businessType ?? 'store' } },
    })
    const member = await prisma.workspace_members.findFirstOrThrow({ where: { user_id: user.id } })
    return { userId: user.id, email, workspaceId: member.workspace_id, db: tenantDb(member.workspace_id) }
  }

  /** Deletes what `workspace()` created (cascades to the workspace data). */
  async function cleanup(...made: { userId: string; workspaceId: string }[]) {
    await prisma.workspaces.deleteMany({ where: { id: { in: made.map((m) => m.workspaceId) } } })
    await prisma.users.deleteMany({ where: { id: { in: made.map((m) => m.userId) } } })
  }

  return { prisma, tenantDb, workspace, cleanup }
}
