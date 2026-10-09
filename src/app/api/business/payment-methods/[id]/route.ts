import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { invalidateBusinessContext } from '@/lib/ai/context'
import { parsePaymentMethod } from '@/lib/business/setup-input'
import { assertQrUrl, removeQr } from '@/lib/business/payment-qr'
import { badRequest, errorResponse, idParam, notFound, readBody } from '@/lib/business/setup-server'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH  /api/business/payment-methods/[id] { …any field } (admins) → { ok }
 *   A replaced or removed QR image file is deleted; a newly uploaded one is
 *   deleted again if the update fails.
 * DELETE /api/business/payment-methods/[id] (admins) — also deletes its QR image. → { ok }
 */
export async function PATCH(request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  const body = await readBody(request)
  if (!body) return badRequest('Invalid JSON body')
  const { db, workspace } = guard.ctx
  let uploaded: string | null = null
  try {
    const current = await db.payment_methods.findFirst({ where: { id }, select: { qr_image_url: true } })
    const data = parsePaymentMethod(body, true) as { qr_image_url?: string | null }
    const qrChanged = 'qr_image_url' in data && data.qr_image_url !== (current?.qr_image_url ?? null)
    if (qrChanged) {
      assertQrUrl(data.qr_image_url, workspace.id, current?.qr_image_url ?? null)
      uploaded = data.qr_image_url ?? null
    }
    if (!current) {
      if (uploaded) await removeQr(uploaded, workspace.id)
      return notFound()
    }
    const { count } = await db.payment_methods.updateMany({ where: { id }, data: { ...data, updated_at: new Date() } })
    if (!count) {
      if (uploaded) await removeQr(uploaded, workspace.id)
      return notFound()
    }
    if (qrChanged) await removeQr(current.qr_image_url, workspace.id)
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (uploaded) await removeQr(uploaded, workspace.id)
    return errorResponse('business/payment-methods', err)
  }
}

export async function DELETE(_request: Request, { params }: Params) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const id = await idParam(params)
  if (!id) return badRequest('Invalid id')
  const { db, workspace } = guard.ctx
  try {
    const current = await db.payment_methods.findFirst({ where: { id }, select: { qr_image_url: true } })
    if (!current) return notFound()
    await db.payment_methods.deleteMany({ where: { id } })
    await removeQr(current.qr_image_url, workspace.id)
    invalidateBusinessContext(workspace.id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return errorResponse('business/payment-methods', err)
  }
}
