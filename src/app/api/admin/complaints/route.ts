import { NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { adminListComplaints } from '@/lib/complaints/server'

/** GET ?status=pending|answered → { complaints, counts } (platform admin). */
export async function GET(request: Request) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const s = new URL(request.url).searchParams.get('status')
  return NextResponse.json(await adminListComplaints(s === 'pending' || s === 'answered' ? s : null))
}
