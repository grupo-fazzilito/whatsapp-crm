import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** GET ?status=pending|delivered|failed — the 50 most recent deliveries of the endpoint. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const status = new URL(request.url).searchParams.get('status')
  let q = supabaseAdmin()
    .from('webhook_deliveries')
    .select('id, event_id, event_type, payload, status, attempts, next_attempt_at, last_attempt_at, response_status, response_body, error, duration_ms, created_at')
    .eq('workspace_id', guard.ctx.workspace.id)
    .eq('endpoint_id', id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (status && ['pending', 'delivered', 'failed'].includes(status)) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deliveries: data ?? [] })
}
