import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid } from '@/lib/workspace/constants'
import { newInviteToken } from '@/lib/workspace/invitations'
import { sendEmail } from '@/lib/email/send'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function GET() {
  const g = await requireWorkspace('admin')
  if (!g.ok) return g.response
  const { data, error } = await supabaseAdmin()
    .from('workspace_invitations')
    .select('id, workspace_id, email, role, expires_at, accepted_at, created_at')
    .eq('workspace_id', g.ctx.workspace.id)
    .is('accepted_at', null)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invitations: data ?? [] })
}

// POST {email, role} — creates (or refreshes) an invitation and emails the link.
export async function POST(req: NextRequest) {
  const g = await requireWorkspace('admin')
  if (!g.ok) return g.response
  const body = await req.json().catch(() => ({}))
  const email = String(body.email ?? '').trim().toLowerCase()
  const role = body.role === 'admin' ? 'admin' : 'agent'
  if (!EMAIL_RE.test(email)) return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  if (role === 'admin' && !hasRole(g.ctx.role, 'owner')) {
    return NextResponse.json({ error: 'Only owners can invite admins' }, { status: 403 })
  }

  const db = supabaseAdmin()
  const { data: existingProfile } = await db.from('profiles').select('user_id').ilike('email', email).maybeSingle()
  if (existingProfile) {
    const { data: already } = await db
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', g.ctx.workspace.id)
      .eq('user_id', existingProfile.user_id)
      .maybeSingle()
    if (already) return NextResponse.json({ error: 'Already a member' }, { status: 400 })
  }

  // One pending invitation per email.
  await db
    .from('workspace_invitations')
    .delete()
    .eq('workspace_id', g.ctx.workspace.id)
    .ilike('email', email)
    .is('accepted_at', null)

  const { token, hash } = newInviteToken()
  const { data: inv, error } = await db
    .from('workspace_invitations')
    .insert({ workspace_id: g.ctx.workspace.id, email, role, token_hash: hash, invited_by: g.ctx.user.id })
    .select('id, workspace_id, email, role, expires_at, accepted_at, created_at')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const origin = process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
  const link = `${origin}/invite/${token}`
  const es = g.ctx.workspace.locale === 'es'
  const subject = es
    ? `Te invitaron a ${g.ctx.workspace.name} en ChatNexGen`
    : `You're invited to ${g.ctx.workspace.name} on ChatNexGen`
  const text = es
    ? `Te invitaron a unirte a ${g.ctx.workspace.name}. Acepta la invitación aquí (vence en 7 días):\n${link}`
    : `You've been invited to join ${g.ctx.workspace.name}. Accept here (expires in 7 days):\n${link}`

  let delivered = false
  try {
    delivered = (await sendEmail({ to: email, subject, text })).delivered
  } catch (err) {
    console.error('[invitations] email failed:', err)
  }

  // Without SMTP the admin can copy the link from the response.
  return NextResponse.json({ invitation: inv, delivered, link: delivered ? undefined : link })
}

export async function DELETE(req: NextRequest) {
  const g = await requireWorkspace('admin')
  if (!g.ok) return g.response
  const id = req.nextUrl.searchParams.get('id')
  if (!isUuid(id)) return NextResponse.json({ error: 'Invalid invitation' }, { status: 400 })
  const { error } = await supabaseAdmin()
    .from('workspace_invitations')
    .delete()
    .eq('id', id)
    .eq('workspace_id', g.ctx.workspace.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
