import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'
import { disabledTypes, isAdminNotificationType } from '@/lib/admin/notifications'

const KEY = 'admin_notifications'

/** GET /api/admin/notifications/settings — platform admins. → { disabled } */
export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const row = await prisma.platform_settings.findUnique({ where: { key: KEY } })
  return NextResponse.json({ disabled: disabledTypes(row?.value) })
}

/** PUT /api/admin/notifications/settings { disabled: type[] } — which events don't notify. */
export async function PUT(request: Request) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { disabled?: unknown } | null
  if (!Array.isArray(body?.disabled)) return NextResponse.json({ error: 'disabled must be a list' }, { status: 400 })
  const disabled = [...new Set(body.disabled.filter(isAdminNotificationType))]
  const user = await getSessionUser()
  await prisma.platform_settings.upsert({
    where: { key: KEY },
    create: { key: KEY, value: { disabled }, updated_by: user?.id ?? null },
    update: { value: { disabled }, updated_by: user?.id ?? null, updated_at: new Date() },
  })
  return NextResponse.json({ disabled })
}
