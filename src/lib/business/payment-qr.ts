import 'server-only'
import { removeObjects } from '@/lib/storage'
import { storagePathFromUrl } from '@/lib/storage/paths'
import { InputError } from './setup-input'

/** Catalog-bucket path of a QR image owned by `workspaceId`, or null. */
export function ownedQrPath(url: string | null | undefined, workspaceId: string): string | null {
  const path = storagePathFromUrl(url, 'catalog')
  return path && !path.includes('..') && path.startsWith(`${workspaceId}/`) ? path : null
}

/** A new qr_image_url must be one of this workspace's catalog files (or the one already stored). */
export function assertQrUrl(url: unknown, workspaceId: string, current: string | null = null) {
  if (url === null || url === undefined || url === current) return
  if (typeof url !== 'string' || !ownedQrPath(url, workspaceId)) throw new InputError('qr_image_url must be an uploaded image')
}

/** Best-effort removal of a QR image file (only inside the workspace folder). */
export async function removeQr(url: string | null | undefined, workspaceId: string) {
  const path = ownedQrPath(url, workspaceId)
  if (!path) return
  await removeObjects('catalog', [path]).catch((err) => console.error('[payment-methods] qr cleanup failed:', err instanceof Error ? err.message : err))
}
