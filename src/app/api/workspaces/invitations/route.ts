import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db/prisma'
import { requireWorkspace } from '@/lib/workspace/context'
import { hasRole, isUuid } from '@/lib/workspace/constants'
import { newInviteToken } from '@/lib/workspace/invitations'
import { sendEmail } from '@/lib/email/send'
import { publicOrigin } from '@/lib/site-origin'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITATION_COLUMNS = { id: true, workspace_id: true, email: true, role: true, expires_at: true, accepted_at: true, created_at: true } as const

export async function GET() {
  const g = await requireWorkspace('admin')
  if (!g.ok) return g.response
  try {
    const data = await g.ctx.db.workspace_invitations.findMany({
      where: { accepted_at: null },
      select: INVITATION_COLUMNS,
      orderBy: { created_at: 'desc' },
    })
    return NextResponse.json({ invitations: data })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
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

  const db = g.ctx.db
  // Platform client: profiles are not per workspace.
  const existingProfile = await prisma.profiles
    .findFirst({ where: { email: { equals: email, mode: 'insensitive' } }, select: { user_id: true } })
    .catch(() => null)
  if (existingProfile) {
    const already = await db.workspace_members
      .findFirst({ where: { user_id: existingProfile.user_id }, select: { id: true } })
      .catch(() => null)
    if (already) return NextResponse.json({ error: 'Already a member' }, { status: 400 })
  }

  // One pending invitation per email.
  await db.workspace_invitations
    .deleteMany({ where: { email: { equals: email, mode: 'insensitive' }, accepted_at: null } })
    .catch((err) => console.error('[invitations] cleanup failed:', err instanceof Error ? err.message : String(err)))

  const { token, hash } = newInviteToken()
  let inv
  try {
    inv = await db.workspace_invitations.create({
      data: { workspace_id: g.ctx.workspace.id, email, role, token_hash: hash, invited_by: g.ctx.user.id },
      select: INVITATION_COLUMNS,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }

  const origin = publicOrigin(req)
  const link = `${origin}/invite/${token}`
  const es = g.ctx.workspace.locale === 'es'
  const subject = es
    ? `Te invitaron a ${g.ctx.workspace.name} en Whasalia`
    : `You're invited to ${g.ctx.workspace.name} on Whasalia`
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
  try {
    await g.ctx.db.workspace_invitations.deleteMany({ where: { id } })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
  return NextResponse.json({ ok: true })
}
