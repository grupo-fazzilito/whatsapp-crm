import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { prisma } from '@/lib/db/prisma'
import { isUuid } from '@/lib/workspace/constants'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateWebhookSecret } from '@/lib/webhooks/signature'

/** POST → { secret } (new signing secret, shown once; the old one stops working). */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const secret = generateWebhookSecret()
  const { count } = await prisma.platform_webhook_endpoints.updateMany({ where: { id }, data: { secret_encrypted: encrypt(secret) } })
  if (!count) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ secret })
}
