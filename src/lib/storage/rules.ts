// Who may write/sign which paths, and upload limits. Pure.
import { ATTACHMENT_MAX_BYTES } from '@/lib/channels/capabilities'
import type { Bucket } from './paths'

export const UPLOAD_LIMITS: Record<Bucket, { maxBytes: number; imagesOnly: boolean }> = {
  attachments: { maxBytes: ATTACHMENT_MAX_BYTES, imagesOnly: false },
  catalog: { maxBytes: 10 * 1024 * 1024, imagesOnly: true },
  avatars: { maxBytes: 5 * 1024 * 1024, imagesOnly: true },
}

/** Paths are namespaced: attachments/catalog by workspace id, avatars by user id. */
export function ownerPrefix(bucket: Bucket, ctx: { workspaceId: string; userId: string }): string {
  return bucket === 'avatars' ? `${ctx.userId}/` : `${ctx.workspaceId}/`
}

export function pathAllowed(bucket: Bucket, path: string, ctx: { workspaceId: string; userId: string }): boolean {
  if (!path || path.includes('..') || path.startsWith('/') || path.includes('\\')) return false
  return path.startsWith(ownerPrefix(bucket, ctx)) && path.length > ownerPrefix(bucket, ctx).length && path.length <= 500
}
