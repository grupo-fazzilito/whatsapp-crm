import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import {
  GRAPH_VERSION_RE,
  generateVerifyToken,
  maskedMetaSettings,
  updateMetaSettings,
  type MetaSettingsUpdate,
} from '@/lib/platform/meta'

// Platform Meta app (admin panel): app id, app secret (write-only),
// webhook verify token, Embedded Signup / Login configuration ids, Graph version.

function origin(req: NextRequest) {
  return process.env.NEXT_PUBLIC_SITE_URL || req.nextUrl.origin
}

export async function GET(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await maskedMetaSettings(origin(req)))
}

const ID_RE = /^\d{5,32}$/
const SECRET_RE = /^[A-Za-z0-9]{16,128}$/
const TOKEN_RE = /^[\x21-\x7e]{8,200}$/

export async function PUT(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: MetaSettingsUpdate = {}
  const fields: [keyof MetaSettingsUpdate, RegExp, string][] = [
    ['app_id', ID_RE, 'app_id must be numeric'],
    ['es_config_id', ID_RE, 'es_config_id must be numeric'],
    ['es_coex_config_id', ID_RE, 'es_coex_config_id must be numeric'],
    ['login_config_id', ID_RE, 'login_config_id must be numeric'],
    ['graph_version', GRAPH_VERSION_RE, 'graph_version must look like v25.0'],
    ['app_secret', SECRET_RE, 'app_secret looks invalid'],
    ['verify_token', TOKEN_RE, 'verify_token must be 8–200 visible characters'],
  ]
  for (const [key, re, msg] of fields) {
    if (!(key in body)) continue
    const v = body[key]
    if (v === null || v === '') update[key] = null
    else if (typeof v === 'string' && re.test(v.trim())) update[key] = v.trim()
    else return NextResponse.json({ error: msg }, { status: 400 })
  }
  // Server-side generator so the token never depends on the browser's RNG.
  if (body.generate_verify_token === true) update.verify_token = generateVerifyToken()

  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  await updateMetaSettings(update, user?.id ?? null)
  return NextResponse.json(await maskedMetaSettings(origin(req)))
}
