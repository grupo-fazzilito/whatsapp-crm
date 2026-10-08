import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { createCapture, displayPhotoUrls, isCaptureStatus, type PropertyCapture } from '@/lib/real-estate/captures'

const LIST_LIMIT = 500

/**
 * GET /api/captures?status=&q=&mine=1 — any member. Newest first, with the
 * contact and a displayable cover photo (`cover`).
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, workspace, user } = guard.ctx
  const sp = new URL(request.url).searchParams

  let q = supabase
    .from('property_captures')
    .select('*, contact:contacts(id, name, phone)')
    .eq('workspace_id', workspace.id)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  const status = sp.get('status')
  if (status && isCaptureStatus(status)) q = q.eq('status', status)
  if (sp.get('mine') === '1') q = q.eq('assigned_user_id', user.id)
  const text = (sp.get('q') ?? '').trim().replace(/[%,()*\\"]/g, ' ').slice(0, 80)
  if (text) q = q.or(`owner_name.ilike.%${text}%,address.ilike.%${text}%,district.ilike.%${text}%,owner_phone.ilike.%${text}%`)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const rows = (data ?? []) as (PropertyCapture & { contact: unknown })[]
  const covers = await displayPhotoUrls(rows.map((r) => r.photos?.[0] ?? ''))
  return NextResponse.json({ captures: rows.map((r, i) => ({ ...r, cover: covers[i] || null })) })
}

/** POST /api/captures — any member; manual capture. Body: CaptureFields (+ contact_id, conversation_id). */
export async function POST(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid' }, { status: 400 })

  const res = await createCapture({
    workspaceId: workspace.id,
    contactId: typeof body.contact_id === 'string' ? body.contact_id : null,
    conversationId: typeof body.conversation_id === 'string' ? body.conversation_id : null,
    fields: body,
    source: 'manual',
    createdBy: user.id,
    notify: false,
  })
  if (!res.ok) {
    const status = res.error === 'invalid' ? 400 : res.error === 'not_found' ? 404 : 500
    return NextResponse.json({ error: res.error, ...('errors' in res ? { errors: res.errors } : {}) }, { status })
  }
  return NextResponse.json({ capture: res.capture, created: res.created }, { status: res.created ? 201 : 200 })
}
