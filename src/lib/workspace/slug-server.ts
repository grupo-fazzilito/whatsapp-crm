import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { slugProblem, type SlugProblem } from './slug'

// Slug lookups and changes (platform-level: the slug is global).

/**
 * The workspace at `slug`: its current address or an old one it moved from
 * (the caller redirects when the returned slug differs).
 */
export async function findWorkspaceBySlug<S extends Record<string, true>>(slug: string, select: S) {
  const sel = { ...select, slug: true } as S & { slug: true }
  const current = await prisma.workspaces.findFirst({ select: sel, where: { slug } })
  if (current) return current
  const moved = await prisma.workspace_slug_redirects.findUnique({ select: { workspace_id: true }, where: { slug } })
  return moved ? prisma.workspaces.findFirst({ select: sel, where: { id: moved.workspace_id } }) : null
}

/** Free for this workspace: nobody else uses it, now or as an old address. */
export async function slugAvailable(slug: string, workspaceId: string): Promise<boolean> {
  const [ws, old] = await Promise.all([
    prisma.workspaces.findFirst({ select: { id: true }, where: { slug, id: { not: workspaceId } } }),
    prisma.workspace_slug_redirects.findFirst({ select: { slug: true }, where: { slug, workspace_id: { not: workspaceId } } }),
  ])
  return !ws && !old
}

export type SlugChange = { ok: true; slug: string } | { ok: false; error: SlugProblem | 'taken' }

/** Moves the workspace to `slug`; its current address keeps redirecting here. */
export async function changeWorkspaceSlug(workspaceId: string, slug: string): Promise<SlugChange> {
  const problem = slugProblem(slug)
  if (problem) return { ok: false, error: problem }
  const ws = await prisma.workspaces.findUnique({ select: { slug: true }, where: { id: workspaceId } })
  if (!ws) return { ok: false, error: 'taken' }
  if (ws.slug === slug) return { ok: true, slug }
  if (!(await slugAvailable(slug, workspaceId))) return { ok: false, error: 'taken' }
  try {
    await prisma.$transaction([
      // Taking back one of its own old addresses: it stops being a redirect.
      prisma.workspace_slug_redirects.deleteMany({ where: { slug, workspace_id: workspaceId } }),
      prisma.workspace_slug_redirects.upsert({
        where: { slug: ws.slug },
        create: { slug: ws.slug, workspace_id: workspaceId },
        update: { workspace_id: workspaceId },
      }),
      prisma.workspaces.update({ where: { id: workspaceId }, data: { slug } }),
    ])
  } catch (err) {
    // Someone took it in between (unique slug).
    if ((err as { code?: string })?.code === 'P2002') return { ok: false, error: 'taken' }
    throw err
  }
  return { ok: true, slug }
}
