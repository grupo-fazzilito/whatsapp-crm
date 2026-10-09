import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { removeObjects } from '@/lib/storage'

const MAX_PATHS = 50

/**
 * DELETE /api/quick-replies/attachments { paths: string[] } — any member.
 * Removes uploaded quick-reply files that no reply references any more
 * (uploads discarded in the editor, files dropped from a saved reply).
 * Only paths under <workspace id>/quick-replies/ are considered and files
 * still referenced by a quick reply of the workspace are kept.
 * → { removed: string[] }
 */
export async function DELETE(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db, workspace } = guard.ctx

  const body = (await request.json().catch(() => null)) as { paths?: unknown } | null
  const prefix = `${workspace.id}/quick-replies/`
  const paths = (Array.isArray(body?.paths) ? body.paths : [])
    .filter((p): p is string => typeof p === 'string' && p.startsWith(prefix) && !p.includes('..') && p.length <= 500)
    .slice(0, MAX_PATHS)
  if (!paths.length) return NextResponse.json({ removed: [] })

  try {
    const rows = await db.quick_replies.findMany({ select: { attachments: true } })
    const referenced = new Set<string>()
    for (const r of rows) {
      for (const a of (Array.isArray(r.attachments) ? r.attachments : []) as { path?: unknown }[]) {
        if (a && typeof a.path === 'string') referenced.add(a.path)
      }
    }
    const removed = paths.filter((p) => !referenced.has(p))
    if (removed.length) await removeObjects('attachments', removed)
    return NextResponse.json({ removed })
  } catch (err) {
    console.error('[quick-replies] attachment cleanup failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'cleanup_failed' }, { status: 500 })
  }
}
