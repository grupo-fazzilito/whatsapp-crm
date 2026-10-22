import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { prisma } from '@/lib/db/prisma'

/** GET /api/admin/impersonations — platform admins. Latest visits to customer accounts. */
export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const rows = await prisma.admin_impersonations.findMany({
    orderBy: { started_at: 'desc' },
    take: 200,
    select: { id: true, admin_email: true, target_email: true, workspace_name: true, ip_address: true, started_at: true, ended_at: true },
  })
  return NextResponse.json({ impersonations: rows })
}
