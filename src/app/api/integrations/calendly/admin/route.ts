import { NextRequest, NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth/session'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { maskedCalendlySettings, updateCalendlySettings } from '@/lib/integrations/calendly/config'

// Platform Calendly OAuth app (admin panel). Secrets are write-only.

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(await maskedCalendlySettings())
}

const TOKEN_RE = /^[A-Za-z0-9._~+/=-]{8,300}$/

export async function PUT(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
  const update: Record<string, string | null> = {}
  for (const k of ['client_id', 'client_secret', 'webhook_signing_key'] as const) {
    if (!(k in body)) continue
    const v = body[k]
    if (v === null || (k === 'client_id' && v === '')) update[k] = null
    else if (typeof v === 'string' && v.trim()) {
      if (!TOKEN_RE.test(v.trim())) return NextResponse.json({ error: `invalid ${k}` }, { status: 400 })
      update[k] = v.trim()
    }
  }
  const user = await getSessionUser()
  await updateCalendlySettings(update, user?.id ?? null)
  return NextResponse.json(await maskedCalendlySettings())
}
