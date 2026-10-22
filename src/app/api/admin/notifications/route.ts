import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getSessionUser } from '@/lib/auth/session'
import { prisma } from '@/lib/db/prisma'

async function adminId(): Promise<string | null> {
  if (!(await isPlatformAdmin())) return null
  return (await getSessionUser())?.id ?? null
}

/** GET /api/admin/notifications — platform admins. Latest 50 + this admin's unread count. */
export async function GET() {
  const me = await adminId()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [rows, unread] = await Promise.all([
    prisma.platform_notifications.findMany({
      orderBy: { created_at: 'desc' },
      take: 50,
      select: { id: true, type: true, data: true, read_by: true, created_at: true, workspaces: { select: { name: true } } },
    }),
    prisma.platform_notifications.count({ where: { NOT: { read_by: { has: me } } } }),
  ])
  return NextResponse.json({
    unread,
    notifications: rows.map((r) => ({
      id: r.id,
      type: r.type,
      data: r.data,
      workspace_name: r.workspaces?.name ?? null,
      created_at: r.created_at,
      read: r.read_by.includes(me),
    })),
  })
}

/** PATCH /api/admin/notifications { ids } | { all: true } — marks them read for this admin. */
export async function PATCH(request: Request) {
  const me = await adminId()
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { ids?: unknown; all?: unknown } | null
  const ids = Array.isArray(body?.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 200) : []
  if (body?.all !== true && !ids.length) return NextResponse.json({ error: 'ids or all required' }, { status: 400 })
  await prisma.$executeRaw`
    UPDATE public.platform_notifications
       SET read_by = array_append(read_by, ${me}::uuid)
     WHERE NOT (${me}::uuid = ANY (read_by))
       AND (${body?.all === true} OR id = ANY (${ids}::uuid[]))`
  const unread = await prisma.platform_notifications.count({ where: { NOT: { read_by: { has: me } } } })
  return NextResponse.json({ unread })
}
