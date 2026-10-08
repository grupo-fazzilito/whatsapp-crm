import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { publishCapture } from '@/lib/real-estate/captures'
import { propertyUrl } from '@/lib/real-estate/listing/url'

/**
 * POST /api/captures/[id]/publish — admins (catalog writes are admin-only).
 * Creates an active listing from the capture and links it.
 */
export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx
  const { id } = await ctx.params
  const res = await publishCapture(workspace.id, id, user.id)
  if (!res.ok) {
    const status = res.error === 'not_found' ? 404 : res.error === 'already_published' ? 409 : 500
    if (res.detail) console.error('[captures/publish]', res.detail)
    return NextResponse.json({ error: res.error }, { status })
  }
  return NextResponse.json({
    productId: res.productId,
    publicUrl: propertyUrl(workspace, { id: res.productId }),
    photosFailed: res.photosFailed,
    capture: res.capture,
  })
}
