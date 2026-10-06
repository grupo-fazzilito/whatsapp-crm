import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import {
  AI_PROVIDERS,
  getAiConfig,
  getPlatformSetting,
  maskedAiSettings,
  updateAiSettings,
  type AiProvider,
  type AiSettingsUpdate,
  type StoredAiSettings,
} from '@/lib/platform/settings'

// Platform AI provider settings. Keys are write-only: GET never returns
// them, only whether each provider is configured and where from.

export async function GET() {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [cfg, stored] = await Promise.all([getAiConfig(), getPlatformSetting<StoredAiSettings>('ai')])
  return NextResponse.json(maskedAiSettings(cfg, stored))
}

const MODEL_RE = /^[a-zA-Z0-9._:\/-]{1,80}$/

export async function PUT(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  const update: AiSettingsUpdate = {}
  if (Array.isArray(body.provider_order)) {
    update.provider_order = body.provider_order.filter((p: unknown): p is AiProvider =>
      typeof p === 'string' && (AI_PROVIDERS as readonly string[]).includes(p),
    )
  }
  if (body.keys && typeof body.keys === 'object') {
    update.keys = {}
    for (const p of AI_PROVIDERS) {
      const v = body.keys[p]
      if (v === null) update.keys[p] = null
      else if (typeof v === 'string' && v.trim()) {
        if (v.trim().length > 300) return NextResponse.json({ error: `${p}: key too long` }, { status: 400 })
        update.keys[p] = v.trim()
      }
    }
  }
  if (body.models && typeof body.models === 'object') {
    update.models = {}
    for (const p of AI_PROVIDERS) {
      const v = body.models[p]
      if (v === null || v === '') update.models[p] = null
      else if (typeof v === 'string') {
        if (!MODEL_RE.test(v.trim())) return NextResponse.json({ error: `${p}: invalid model name` }, { status: 400 })
        update.models[p] = v.trim()
      }
    }
  }
  if ('deepseek_base_url' in body) {
    const v = body.deepseek_base_url
    if (v && (typeof v !== 'string' || !/^https:\/\/[^\s]+$/.test(v))) {
      return NextResponse.json({ error: 'deepseek_base_url must be an https URL' }, { status: 400 })
    }
    update.deepseek_base_url = v || null
  }

  const {
    data: { user },
  } = await (await createClient(null)).auth.getUser()
  await updateAiSettings(update, user?.id ?? null)

  const [cfg, stored] = await Promise.all([getAiConfig(), getPlatformSetting<StoredAiSettings>('ai')])
  return NextResponse.json(maskedAiSettings(cfg, stored))
}
