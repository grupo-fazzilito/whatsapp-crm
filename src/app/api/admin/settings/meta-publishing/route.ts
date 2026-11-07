import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { maskedPublishingSettings, updatePublishingSettings, type PublishingUpdate } from '@/lib/social/config'
import { publicOrigin } from '@/lib/site-origin'

// Second Meta app, for Publicaciones: app id, app secret (write-only), Login configuration id.

const ID_RE = /^\d{5,32}$/
const SECRET_RE = /^[A-Za-z0-9]{16,128}$/

export async function GET(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await maskedPublishingSettings(publicOrigin(req)))
}

export async function PUT(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const update: PublishingUpdate = {}
  const fields: [keyof PublishingUpdate, RegExp, string][] = [
    ['app_id', ID_RE, 'app_id must be numeric'],
    ['config_id', ID_RE, 'config_id must be numeric'],
    ['app_secret', SECRET_RE, 'app_secret looks invalid'],
  ]
  for (const [key, re, msg] of fields) {
    if (!(key in body)) continue
    const v = body[key]
    if (v === null || v === '') update[key] = null
    else if (typeof v === 'string' && re.test(v.trim())) update[key] = v.trim()
    else return NextResponse.json({ error: msg }, { status: 400 })
  }
  const user = await getSessionUser()
  await updatePublishingSettings(update, user?.id ?? null)
  return NextResponse.json(await maskedPublishingSettings(publicOrigin(req)))
}
