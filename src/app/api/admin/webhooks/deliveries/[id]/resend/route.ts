import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { isUuid } from '@/lib/workspace/constants'
import { resendPlatformDelivery } from '@/lib/webhooks/platform'

/** POST → re-sends the delivery's event now (as a new delivery). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const out = await resendPlatformDelivery(id)
  if ('error' in out) return NextResponse.json(out, { status: out.error === 'not_found' ? 404 : 409 })
  return NextResponse.json(out)
}
