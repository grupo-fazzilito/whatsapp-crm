import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parsePaymentMethod } from '@/lib/business/setup-input'
import { assertQrUrl, removeQr } from '@/lib/business/payment-qr'
import { badRequest, errorResponse, readBody } from '@/lib/business/setup-server'

const PAYMENT_METHOD_SELECT = {
  id: true,
  name: true,
  type: true,
  instructions: true,
  qr_image_url: true,
  requires_proof: true,
  is_active: true,
  sort_order: true,
} as const

/**
 * GET  /api/business/payment-methods → { methods } (members; by sort_order, name)
 * POST /api/business/payment-methods { name, type?, instructions?, qr_image_url?, requires_proof?, is_active? } (admins)
 *   Goes last in the list. qr_image_url must be a catalog upload of this workspace
 *   (a just-uploaded image is removed again if the insert fails). → { method }
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  try {
    const methods = await guard.ctx.db.payment_methods.findMany({
      select: PAYMENT_METHOD_SELECT,
      orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
    })
    return NextResponse.json({ methods })
  } catch (err) {
    return errorResponse('business/payment-methods', err)
  }
}

export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  let uploaded: string | null = null
  try {
    const data = parsePaymentMethod(body, false) as { name: string; qr_image_url?: string | null }
    assertQrUrl(data.qr_image_url, workspace.id)
    uploaded = data.qr_image_url ?? null
    const last = await db.payment_methods.aggregate({ _max: { sort_order: true } })
    const method = await db.payment_methods.create({
      data: { ...data, sort_order: (last._max.sort_order ?? -1) + 1, workspace_id: workspace.id },
      select: PAYMENT_METHOD_SELECT,
    })
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ method })
  } catch (err) {
    if (uploaded) await removeQr(uploaded, workspace.id)
    return errorResponse('business/payment-methods', err)
  }
}
