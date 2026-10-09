import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { getLeadProfile, saveLeadProfile } from '@/lib/real-estate/leads/service'
import { sanitizeUserLeadPatch } from '@/lib/real-estate/leads/profile'
import { computeLeadScore } from '@/lib/real-estate/leads/score'

/**
 * GET   /api/real-estate/leads/[contactId] → { profile | null }
 * PATCH /api/real-estate/leads/[contactId] { operation?, zones?, budget_max?, … }
 *   Keys present are set (empty values clear them); the score is
 *   recomputed and a first qualification moves the deal and routes the
 *   conversation. → { profile, qualified, routed_to }
 */
async function guardContact(contactId: string) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return { response: guard.response } as const
  if (!isUuid(contactId)) return { response: NextResponse.json({ error: 'Invalid id' }, { status: 400 }) } as const
  const { db, workspace, user } = guard.ctx
  // Tenant read: the contact must belong to the active workspace.
  const contact = await db.contacts.findFirst({ select: { id: true }, where: { id: contactId } }).catch(() => null)
  if (!contact) return { response: NextResponse.json({ error: 'Not found' }, { status: 404 }) } as const
  return { workspace, user, db } as const
}

export async function GET(_req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params
  const g = await guardContact(contactId)
  if ('response' in g) return g.response
  const profile = await getLeadProfile(g.workspace.id, contactId)
  const breakdown = profile ? computeLeadScore(profile).breakdown : null
  return NextResponse.json({ profile, breakdown })
}

export async function PATCH(request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const { contactId } = await params
  const g = await guardContact(contactId)
  if ('response' in g) return g.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  const patch = sanitizeUserLeadPatch(body)
  const conversationId = typeof body.conversation_id === 'string' && isUuid(body.conversation_id) ? body.conversation_id : null
  if (conversationId) {
    const conv = await g.db.conversations.findFirst({ select: { id: true }, where: { id: conversationId, contact_id: contactId } }).catch(() => null)
    if (!conv) return NextResponse.json({ error: 'Invalid conversation' }, { status: 400 })
  }
  if (!Object.keys(patch).length && !(await getLeadProfile(g.workspace.id, contactId))) {
    return NextResponse.json({ profile: null, qualified: false, routed_to: null })
  }
  const res = await saveLeadProfile({
    workspaceId: g.workspace.id,
    contactId,
    conversationId,
    patch,
    by: 'user',
    replace: true,
    actorId: g.user.id,
  })
  if (!res) return NextResponse.json({ error: 'Failed to save' }, { status: 500 })
  return NextResponse.json({ profile: res.profile, qualified: res.becameQualified, routed_to: res.routedTo })
}
