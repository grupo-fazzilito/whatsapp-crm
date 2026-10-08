import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** DELETE /api/integrations/api-keys/[id] — revokes the key (kept for the audit trail). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const { id } = await params
  if (!isUuid(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const { data, error } = await supabaseAdmin()
    .from('api_keys')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', guard.ctx.workspace.id)
    .is('revoked_at', null)
    .select('id, revoked_at')
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  return NextResponse.json({ key: data })
}
