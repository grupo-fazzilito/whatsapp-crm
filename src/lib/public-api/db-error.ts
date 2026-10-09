import { pgErrorCode } from '@/lib/db/errors'

/**
 * Postgres code + message of a failed Prisma write, shaped like the
 * PostgREST error the API code used to inspect ({ code, message }).
 */
export function pgError(err: unknown): { code: string | null; message: string } {
  const cause = (err as { meta?: { driverAdapterError?: { cause?: { originalMessage?: unknown } } } })?.meta?.driverAdapterError?.cause
  const message = typeof cause?.originalMessage === 'string' ? cause.originalMessage : err instanceof Error ? err.message : String(err)
  return { code: pgErrorCode(err), message }
}
