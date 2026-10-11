import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { isUuid } from '@/lib/workspace/constants'
import { sendPlatformTestPing } from '@/lib/webhooks/platform'

/** POST → sends a "ping" now: { delivered, status, durationMs, error?, deliveryId }. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const out = await sendPlatformTestPing(id)
  if (!out) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json(out)
}
