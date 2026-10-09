import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { getPlatformSetting } from '@/lib/platform/settings'
import { getMlConfig, maskedMlSettings, updateMlSettings, type MlSettingsUpdate, type StoredMlSettings } from '@/lib/real-estate/portals/mercadolibre/config'
import { isMlSite } from '@/lib/real-estate/portals/mercadolibre/endpoints'

// Platform Mercado Libre app (client id / secret). The secret is
// write-only: GET returns whether it is set and its last 4 characters.

async function view() {
  const [cfg, stored] = await Promise.all([getMlConfig(), getPlatformSetting<StoredMlSettings>('mercadolibre')])
  return maskedMlSettings(cfg, stored)
}

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await view())
}

export async function PUT(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: MlSettingsUpdate = {}
  if ('client_id' in body) {
    const v = body.client_id
    if (v !== null && v !== '' && (typeof v !== 'string' || !/^\d{1,30}$/.test(v.trim()))) {
      return NextResponse.json({ error: 'client_id must be the numeric App ID' }, { status: 400 })
    }
    update.client_id = v ? String(v).trim() : null
  }
  if ('client_secret' in body) {
    const v = body.client_secret
    if (v === null) update.client_secret = null
    else if (typeof v === 'string' && v.trim()) {
      if (v.trim().length > 200) return NextResponse.json({ error: 'client_secret too long' }, { status: 400 })
      update.client_secret = v.trim()
    }
  }
  if ('site_id' in body) {
    if (!isMlSite(body.site_id)) return NextResponse.json({ error: 'site_id' }, { status: 400 })
    update.site_id = body.site_id
  }
  if ('pkce' in body) {
    if (typeof body.pkce !== 'boolean') return NextResponse.json({ error: 'pkce must be boolean' }, { status: 400 })
    update.pkce = body.pkce
  }

  const user = await getSessionUser()
  await updateMlSettings(update, user?.id ?? null)
  return NextResponse.json(await view())
}
