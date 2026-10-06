import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getPlatformSetting, setPlatformSetting } from '@/lib/platform/settings'

interface GeneralSettings {
  agency_name?: string
  support_email?: string
}

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json((await getPlatformSetting<GeneralSettings>('general')) ?? {})
}

export async function PUT(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const next: GeneralSettings = {
    agency_name: String(body.agency_name ?? '').trim().slice(0, 120),
    support_email: String(body.support_email ?? '').trim().slice(0, 200),
  }
  if (next.support_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next.support_email)) {
    return NextResponse.json({ error: 'Invalid email' }, { status: 400 })
  }
  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  await setPlatformSetting('general', next, user?.id ?? null)
  return NextResponse.json(next)
}
