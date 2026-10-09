import { Prisma } from '@/generated/prisma/client'

/** True when `err` is a Prisma known request error with this code (P2002 unique, P2025 not found, P2003 FK). */
export function isPrismaError(err: unknown, code: string): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === code
}

/** Postgres error code of a raw query failure (e.g. '23505'), when available. */
export function pgErrorCode(err: unknown): string | null {
  const e = err as { code?: unknown; meta?: { code?: unknown; driverAdapterError?: { cause?: { originalCode?: unknown } } } }
  const original = e?.meta?.driverAdapterError?.cause?.originalCode ?? e?.meta?.code
  return typeof original === 'string' ? original : null
}
