import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { encrypt } from '@/lib/whatsapp/encryption'
import { generateWebhookSecret } from '@/lib/webhooks/signature'

/** POST — new signing secret, returned once. The old one stops working immediately. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const secret = generateWebhookSecret()
  const { data, error } = await supabaseAdmin()
    .from('webhook_endpoints')
    .update({ secret_encrypted: encrypt(secret) })
    .eq('id', id)
    .eq('workspace_id', guard.ctx.workspace.id)
    .select('id')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ secret })
}
