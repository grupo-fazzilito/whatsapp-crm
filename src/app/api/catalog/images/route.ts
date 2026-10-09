import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { discardProductImages } from '@/lib/catalog/manage'

/**
 * DELETE /api/catalog/images { paths } — admins. Removes product images
 * uploaded for a save that failed (only <workspace>/products/… paths that
 * no product uses).
 */
export async function DELETE(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx
  const body = (await request.json().catch(() => null)) as { paths?: unknown } | null
  const paths = body?.paths
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 50 || !paths.every((p) => typeof p === 'string')) {
    return NextResponse.json({ error: 'invalid' }, { status: 400 })
  }
  try {
    return NextResponse.json({ removed: await discardProductImages(db, workspace.id, paths as string[]) })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
