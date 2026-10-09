import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { CONNECTION_SELECT, type CalendarConnection } from '@/lib/integrations/google/api'
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

  // Platform client: the workspace is only known from the channel id.
  const conn = await prisma.calendar_connections
    .findFirst({ select: CONNECTION_SELECT, where: { watch_channel_id: h.channelId } })
    .catch(() => null)
  const secrets = conn
    ? await prisma.calendar_connection_secrets
        .findFirst({ select: { watch_token: true }, where: { connection_id: conn.id, workspace_id: conn.workspace_id } })
        .catch(() => null)
    : null

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
