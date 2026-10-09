import 'server-only'
import { prisma } from './prisma'
import { scopeArgs } from './scope'

/**
 * Prisma client confined to one workspace: every query on a tenant table
 * is filtered by workspace_id and every write lands in that workspace.
 * Raw SQL ($queryRaw/$executeRaw) is not scoped — pass the workspace id
 * as a parameter yourself.
 */
export function tenantDb(workspaceId: string) {
  return prisma.$extends({
    name: `tenant:${workspaceId}`,
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopeArgs(model, operation, args as Record<string, unknown>, workspaceId) as typeof args)
        },
      },
    },
  })
}

export type TenantDb = ReturnType<typeof tenantDb>
