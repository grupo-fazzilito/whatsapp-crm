import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireWorkspace } from '@/lib/workspace/context'
import { storagePathFromUrl } from '@/lib/storage/paths'

/**
 * PATCH /api/profile { full_name?, avatar_url? } — the caller's own profile only.
 * avatar_url must be null, the current value, or a file of the caller's
 * avatars folder (<user id>/…, uploaded through /api/files/upload).
 * Nothing else (email, role, is_platform_admin…) can be changed here.
 * → { profile }
 */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { user } = guard.ctx

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  // Platform client: profiles belong to users, not to a workspace.
  const current = await prisma.profiles.findFirst({ select: { avatar_url: true }, where: { user_id: user.id } })
  if (!current) return NextResponse.json({ error: 'Profile not found' }, { status: 404 })

  const data: { full_name?: string; avatar_url?: string | null } = {}
  if ('full_name' in body) {
    const name = typeof body.full_name === 'string' ? body.full_name.trim() : ''
    if (!name) return NextResponse.json({ error: 'Display name is required' }, { status: 400 })
    data.full_name = name.slice(0, 200)
  }
  if ('avatar_url' in body) {
    const url = body.avatar_url
    if (url === null || url === current.avatar_url) data.avatar_url = (url as string | null) ?? null
    else if (typeof url === 'string' && url.length <= 2000 && storagePathFromUrl(url, 'avatars')?.startsWith(`${user.id}/`)) data.avatar_url = url
    else return NextResponse.json({ error: 'Invalid avatar_url' }, { status: 400 })
  }
  if (!Object.keys(data).length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  try {
    const profile = await prisma.profiles.update({ where: { user_id: user.id }, data })
    return NextResponse.json({ profile })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
