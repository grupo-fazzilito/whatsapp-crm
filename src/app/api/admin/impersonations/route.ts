import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { prisma } from '@/lib/db/prisma'
import { IMPERSONATION_MINUTES } from '@/lib/auth/impersonation'

/** GET /api/admin/impersonations — platform admins. Latest visits to customer accounts. */
export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await closeFinishedVisits()
  const rows = await prisma.admin_impersonations.findMany({
    orderBy: { started_at: 'desc' },
    take: 200,
    select: { id: true, admin_email: true, target_email: true, workspace_name: true, ip_address: true, started_at: true, ended_at: true },
  })
  return NextResponse.json({ impersonations: rows })
}

/**
 * Visits left without the "back" button (tab closed, signed in again, time
 * ran out) still have no end. A visit lasts at most IMPERSONATION_MINUTES,
 * and ends earlier when its session no longer exists.
 */
async function closeFinishedVisits() {
  await prisma
    .$executeRaw`
      UPDATE public.admin_impersonations i
         SET ended_at = LEAST(now(), i.started_at + make_interval(mins => ${IMPERSONATION_MINUTES}))
       WHERE i.ended_at IS NULL
         AND (i.started_at + make_interval(mins => ${IMPERSONATION_MINUTES}) <= now()
              OR NOT EXISTS (SELECT 1 FROM public.auth_sessions s WHERE s.token = i.session_token AND s.expires_at > now()))`
    .catch((err) => console.error('[admin] closing visits failed:', err instanceof Error ? err.message : err))
}
