// Tenant scoping for Prisma queries (replaces Supabase RLS). Pure — the
// Prisma extension in ./tenant.ts calls it for every model operation.
//
// Every model with a workspace_id column gets `workspace_id = <ws>` added
// to its filter, and written rows are forced into <ws>. Asking for another
// workspace explicitly throws instead of silently returning nothing.

export class TenantScopeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TenantScopeError'
  }
}

/** Models without workspace_id. Only the system client may touch the ones not listed in SELF_SCOPED. */
export const UNSCOPED_MODELS = new Set([
  'users',
  'auth_sessions',
  'auth_accounts',
  'auth_verifications',
  'profiles',
  'platform_settings',
  'portfolio_items',
  'channel_secrets',
  'workspaces',
])

const READ_OPS = new Set(['findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow', 'findMany', 'count', 'aggregate', 'groupBy'])
const WHERE_WRITE_OPS = new Set(['update', 'updateMany', 'updateManyAndReturn', 'delete', 'deleteMany'])
const CREATE_OPS = new Set(['create', 'createMany', 'createManyAndReturn'])

type Args = Record<string, unknown> | undefined

function scopedWhere(where: unknown, ws: string, key: string, model: string): Record<string, unknown> {
  const w = (where ?? {}) as Record<string, unknown>
  if (key in w && w[key] !== ws) {
    throw new TenantScopeError(`${model}: ${key} filter must be the current workspace`)
  }
  return { ...w, [key]: ws }
}

function scopedData(data: unknown, ws: string, model: string, creating: boolean): Record<string, unknown> {
  const d = (data ?? {}) as Record<string, unknown>
  if ('workspace_id' in d && d.workspace_id !== ws) {
    throw new TenantScopeError(`${model}: cannot write rows of another workspace`)
  }
  if ('workspaces' in d) throw new TenantScopeError(`${model}: connect the workspace through workspace_id`)
  return creating ? { ...d, workspace_id: ws } : d
}

/**
 * Returns the args to run `operation` on `model` inside workspace `ws`.
 * Throws TenantScopeError for operations that cannot be scoped safely.
 */
export function scopeArgs(model: string, operation: string, args: Args, ws: string): Args {
  if (!ws) throw new TenantScopeError('missing workspace id')
  // The workspace row itself: only its own id.
  if (model === 'workspaces') {
    if (READ_OPS.has(operation) || operation === 'update' || operation === 'updateMany') {
      return { ...(args ?? {}), where: scopedWhere(args?.where, ws, 'id', model) }
    }
    throw new TenantScopeError(`workspaces.${operation} is not allowed from a tenant client`)
  }
  if (UNSCOPED_MODELS.has(model)) {
    throw new TenantScopeError(`${model} has no workspace: use the system client`)
  }

  if (READ_OPS.has(operation)) return { ...(args ?? {}), where: scopedWhere(args?.where, ws, 'workspace_id', model) }

  if (WHERE_WRITE_OPS.has(operation)) {
    const next: Record<string, unknown> = { ...(args ?? {}), where: scopedWhere(args?.where, ws, 'workspace_id', model) }
    if (args && 'data' in args) next.data = scopedData(args.data, ws, model, false)
    return next
  }

  if (CREATE_OPS.has(operation)) {
    const data = args?.data
    return {
      ...(args ?? {}),
      data: Array.isArray(data) ? data.map((d) => scopedData(d, ws, model, true)) : scopedData(data, ws, model, true),
    }
  }

  if (operation === 'upsert') {
    return {
      ...(args ?? {}),
      where: scopedWhere(args?.where, ws, 'workspace_id', model),
      create: scopedData(args?.create, ws, model, true),
      update: scopedData(args?.update, ws, model, false),
    }
  }

  throw new TenantScopeError(`${model}.${operation} is not supported by the tenant client`)
}
