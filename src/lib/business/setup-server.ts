import 'server-only'
import { NextResponse } from 'next/server'
import type { TenantDb } from '@/lib/db/tenant'
import { isPrismaError, pgErrorCode } from '@/lib/db/errors'
import { TenantScopeError } from '@/lib/db/scope'
import { InputError, isPlainObject, isUuid } from './setup-input'

/** JSON body as an object, or null. */
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const body = await request.json().catch(() => null)
  return isPlainObject(body) ? body : null
}

export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 })
export const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

/** Maps errors thrown by a setup route to a JSON response. */
export function errorResponse(scope: string, err: unknown) {
  if (err instanceof InputError || err instanceof TenantScopeError) return badRequest(err.message)
  if (isPrismaError(err, 'P2025')) return notFound()
  if (isPrismaError(err, 'P2002') || pgErrorCode(err) === '23505') return NextResponse.json({ error: 'Already exists' }, { status: 409 })
  if (isPrismaError(err, 'P2003') || pgErrorCode(err) === '23503') {
    return NextResponse.json({ error: 'It is still referenced by other records' }, { status: 409 })
  }
  console.error(`[${scope}]`, err instanceof Error ? err.message : err)
  return NextResponse.json({ error: err instanceof Error ? err.message : 'Unexpected error' }, { status: 500 })
}

/** Route param id, validated. */
export async function idParam(params: Promise<{ id: string }>): Promise<string | null> {
  const { id } = await params
  return isUuid(id) ? id : null
}

type OwnedTable = 'contacts' | 'staff' | 'services' | 'products' | 'ai_agents'

/** Throws InputError unless every id belongs to the workspace of `db`. */
export async function assertOwned(db: TenantDb, table: OwnedTable, ids: (string | null | undefined)[]) {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))]
  if (!wanted.length) return
  const where = { where: { id: { in: wanted } } }
  let found: number
  switch (table) {
    case 'contacts':
      found = await db.contacts.count(where)
      break
    case 'staff':
      found = await db.staff.count(where)
      break
    case 'services':
      found = await db.services.count(where)
      break
    case 'products':
      found = await db.products.count(where)
      break
    case 'ai_agents':
      found = await db.ai_agents.count(where)
      break
  }
  if (found !== wanted.length) throw new InputError(`Unknown ${table} id`)
}
