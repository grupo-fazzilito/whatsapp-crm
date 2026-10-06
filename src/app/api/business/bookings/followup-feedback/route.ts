import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { notifyFromRequest } from '@/lib/bookings/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** POST {bookingId, type: 'feedback' | 'followup'} — post-visit message. */
export async function POST(request: Request) {
  const guard = await requireWorkspace()
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace
  const body = await request.json().catch(() => ({}))
  const type = body.type
  if (type !== 'feedback' && type !== 'followup') {
    return NextResponse.json({ error: 'type ("feedback" | "followup") is required' }, { status: 400 })
  }
  return notifyFromRequest(
    ws,
    body.bookingId ?? body.appointmentId,
    () => type,
    async (b) => {
      await supabaseAdmin()
        .from('bookings')
        .update(type === 'feedback' ? { feedback_sent: true } : { followup_sent: true })
        .eq('id', b.id)
        .eq('workspace_id', ws.id)
    },
  )
}
