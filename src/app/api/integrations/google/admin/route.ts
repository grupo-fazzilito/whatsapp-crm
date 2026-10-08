import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { maskedGoogleSettings, updateGoogleSettings } from '@/lib/integrations/google/config'

// Platform Google OAuth client (admin panel). The secret is write-only.

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await maskedGoogleSettings())
}

const CLIENT_ID_RE = /^[a-zA-Z0-9._-]{8,200}\.apps\.googleusercontent\.com$/

export async function PUT(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const update: { client_id?: string | null; client_secret?: string | null } = {}
  if ('client_id' in body) {
    const v = body.client_id
    if (v === null || v === '') update.client_id = null
    else if (typeof v === 'string' && CLIENT_ID_RE.test(v.trim())) update.client_id = v.trim()
    else return NextResponse.json({ error: 'client_id must look like …apps.googleusercontent.com' }, { status: 400 })
  }
  if ('client_secret' in body) {
    const v = body.client_secret
    if (v === null) update.client_secret = null
    else if (typeof v === 'string' && v.trim()) {
      if (v.trim().length > 200 || /\s/.test(v.trim())) return NextResponse.json({ error: 'invalid client_secret' }, { status: 400 })
      update.client_secret = v.trim()
    }
  }
  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  await updateGoogleSettings(update, user?.id ?? null)
  return NextResponse.json(await maskedGoogleSettings())
}
