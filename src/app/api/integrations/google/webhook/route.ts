import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { CONNECTION_COLUMNS, type CalendarConnection } from '@/lib/integrations/google/api'
import { runAfterResponse, syncConnectionChanges } from '@/lib/integrations/google/sync'
import { checkNotification, readNotificationHeaders } from '@/lib/integrations/google/webhook'

/**
 * Google Calendar push notifications (events.watch). No body: headers
 * identify the channel; changes are fetched with the stored syncToken
 * after we answer 200.
 */
export async function POST(request: Request) {
  const h = readNotificationHeaders(request.headers)
  if (!h.channelId) return NextResponse.json({ error: 'missing channel' }, { status: 400 })

  const db = supabaseAdmin()
  const { data: conn } = await db.from('calendar_connections').select(CONNECTION_COLUMNS).eq('watch_channel_id', h.channelId).maybeSingle()
  const { data: secrets } = conn
    ? await db.from('calendar_connection_secrets').select('watch_token').eq('connection_id', conn.id).maybeSingle()
    : { data: null }

  const check = checkNotification(
    h,
    conn ? { watch_channel_id: conn.watch_channel_id, watch_resource_id: conn.watch_resource_id, watch_token: secrets?.watch_token ?? null } : null,
  )
  if (!check.ok) return new NextResponse(null, { status: check.status })
  if (check.action === 'sync' && (conn as CalendarConnection).status !== 'revoked') {
    runAfterResponse(() => syncConnectionChanges(conn as CalendarConnection))
  }
  return new NextResponse(null, { status: 200 })
}
