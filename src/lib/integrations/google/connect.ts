import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { decrypt, encrypt } from '@/lib/whatsapp/encryption'
import { hasRole, type WorkspaceRole } from '@/lib/workspace/constants'
import { CONNECTION_SELECT, loadSecrets, stopChannel, type CalendarConnection } from './api'
import { getGoogleConfig } from './config'
import { exchangeCode, fetchUserEmail, revokeToken, GoogleApiError } from './oauth'
import { queueUpcomingBookings, setupWatch, syncConnectionChanges, syncPendingBookings, runAfterResponse } from './sync'
import { stateSecret, verifyState } from './state'

/**
 * Who may connect/disconnect a staff member's calendar: workspace admins
 * for anyone; a member only for the staff row linked to them.
 */
export async function canManageStaffCalendar(
  workspaceId: string,
  staffId: string,
  user: { id: string; role: WorkspaceRole },
): Promise<{ ok: true; staff: { id: string; name: string; member_user_id: string | null } } | { ok: false; status: 403 | 404 }> {
  const staff = await tenantDb(workspaceId)
    .staff.findFirst({ select: { id: true, name: true, member_user_id: true }, where: { id: staffId } })
    .catch(() => null)
  if (!staff) return { ok: false, status: 404 }
  if (hasRole(user.role, 'admin') || staff.member_user_id === user.id) return { ok: true, staff }
  return { ok: false, status: 403 }
}

export async function getConnectionForStaff(workspaceId: string, staffId: string): Promise<CalendarConnection | null> {
  const data = await tenantDb(workspaceId)
    .calendar_connections.findFirst({ select: CONNECTION_SELECT, where: { staff_id: staffId } })
    .catch(() => null)
  return (data as CalendarConnection | null) ?? null
}

export type CallbackOutcome =
  | { ok: true; workspaceId: string; staffId: string; email: string | null; back: 'staff' | 'profile' }
  | { ok: false; error: string; back: 'staff' | 'profile' }

/**
 * OAuth callback: validates the signed state against the signed-in user,
 * exchanges the code, stores encrypted tokens, takes the first sync token,
 * opens a push channel (HTTPS only) and queues upcoming bookings.
 */
export async function completeOAuth(params: {
  code: string | null
  state: string | null
  error: string | null
  userId: string | null
}): Promise<CallbackOutcome> {
  const check = verifyState(params.state, stateSecret())
  const back = check.ok ? (check.state.r ?? 'staff') : 'staff'
  if (params.error) return { ok: false, error: params.error === 'access_denied' ? 'denied' : 'google', back }
  if (!check.ok) return { ok: false, error: `state_${check.reason}`, back }
  const st = check.state
  if (!params.userId || params.userId !== st.u) return { ok: false, error: 'session', back }
  if (!params.code) return { ok: false, error: 'code', back }

  // Re-check membership and permission now (the state is 10 minutes old at most).
  // Platform read: the workspace comes from the signed state, not a session.
  const member = await prisma.workspace_members
    .findFirst({ select: { role: true }, where: { workspace_id: st.w, user_id: st.u, status: 'active' } })
    .catch(() => null)
  if (!member) return { ok: false, error: 'forbidden', back }
  const allowed = await canManageStaffCalendar(st.w, st.s, { id: st.u, role: member.role as WorkspaceRole })
  if (!allowed.ok) return { ok: false, error: 'forbidden', back }

  const cfg = await getGoogleConfig()
  if (!cfg) return { ok: false, error: 'not_configured', back }

  let tokens
  try {
    tokens = await exchangeCode(cfg, params.code)
  } catch (err) {
    console.warn('[google] code exchange failed:', err instanceof Error ? err.message : err)
    return { ok: false, error: 'exchange', back }
  }
  if (!tokens.refresh_token) return { ok: false, error: 'no_refresh_token', back }
  const granted = (tokens.scope ?? '').split(' ')
  if (tokens.scope && !granted.includes('https://www.googleapis.com/auth/calendar.events')) {
    await revokeToken(tokens.access_token)
    return { ok: false, error: 'scope', back }
  }

  let email: string | null = null
  try {
    email = await fetchUserEmail(tokens.access_token)
  } catch (err) {
    console.warn('[google] userinfo failed:', err instanceof Error ? err.message : err)
  }

  // Replacing an earlier connection of this staff member: close it first.
  const previous = await getConnectionForStaff(st.w, st.s)
  if (previous) {
    const prevSecrets = await loadSecrets(previous)
    if (previous.watch_channel_id && previous.watch_resource_id) {
      await stopChannel(previous, previous.watch_channel_id, previous.watch_resource_id).catch(() => undefined)
    }
    if (prevSecrets && previous.google_email && previous.google_email !== email) {
      await revokeToken(decrypt(prevSecrets.refresh_token)).catch(() => false)
    }
  }

  const db = tenantDb(st.w)
  const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString()
  const row = {
    workspace_id: st.w,
    staff_id: st.s,
    connected_by: st.u,
    provider: 'google',
    google_email: email,
    calendar_id: 'primary',
    token_expires_at: expiresAt,
    watch_channel_id: null,
    watch_resource_id: null,
    watch_expires_at: null,
    status: 'active',
    last_error: null,
    last_synced_at: null,
  }
  let conn
  try {
    conn = await db.calendar_connections.upsert({ where: { staff_id: st.s }, create: row, update: row, select: CONNECTION_SELECT })
  } catch {
    return { ok: false, error: 'db', back }
  }
  const secrets = {
    connection_id: conn.id,
    workspace_id: st.w,
    access_token: encrypt(tokens.access_token),
    refresh_token: encrypt(tokens.refresh_token),
    sync_token: null,
    watch_token: null,
    updated_at: new Date().toISOString(),
  }
  try {
    await db.calendar_connection_secrets.upsert({ where: { connection_id: conn.id }, create: secrets, update: secrets })
  } catch {
    return { ok: false, error: 'db', back }
  }

  const connection = conn as CalendarConnection
  const ws = await db.workspaces.findFirst({ select: { timezone: true }, where: { id: st.w } }).catch(() => null)
  await queueUpcomingBookings(connection, ws?.timezone ?? 'UTC')

  runAfterResponse(async () => {
    try {
      await syncConnectionChanges(connection)
    } catch (err) {
      console.warn('[google] first sync failed:', err instanceof Error ? err.message : err)
    }
    try {
      await setupWatch(connection)
    } catch (err) {
      const msg = err instanceof GoogleApiError ? err.message : String(err)
      console.warn('[google] watch failed (polling instead):', msg)
    }
    await syncPendingBookings(st.w, 50)
  })

  return { ok: true, workspaceId: st.w, staffId: st.s, email, back }
}
