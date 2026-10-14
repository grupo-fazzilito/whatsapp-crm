import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getSessionUser } from '@/lib/auth/session'
import { isUuid } from '@/lib/workspace/constants'
import { adminGetComplaint, answerComplaint } from '@/lib/complaints/server'

type Ctx = { params: Promise<{ id: string }> }

/** GET → the complaint (platform admin). */
export async function GET(_request: Request, { params }: Ctx) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { id } = await params
  const c = isUuid(id) ? await adminGetComplaint(id) : null
  return c ? NextResponse.json({ complaint: c }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}

/** POST { response } → answers the complaint and emails the consumer (platform admin). */
export async function POST(request: Request, { params }: Ctx) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await getSessionUser()
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { response?: unknown } | null
  const response = typeof body?.response === 'string' ? body.response.trim() : ''
  if (response.length < 10 || response.length > 5000) return NextResponse.json({ error: 'invalid_response' }, { status: 422 })
  const { id } = await params
  const c = isUuid(id) ? await answerComplaint(id, response, admin.id) : null
  return c ? NextResponse.json({ complaint: c }) : NextResponse.json({ error: 'Not found' }, { status: 404 })
}
