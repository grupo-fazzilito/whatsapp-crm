import { NextRequest, NextResponse } from 'next/server'
import { isPlatformAdmin } from '@/lib/admin/guard'
import { AI_PROVIDERS, getAiConfig, type AiProvider } from '@/lib/platform/settings'
import { parseJsonLoose, pingProvider } from '@/lib/ai/llm'

// POST {provider, key?, model?} — sends a tiny request to one provider.
// `key`/`model` let the admin test values before saving them.
export async function POST(req: NextRequest) {
  if (!(await isPlatformAdmin())) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const body = await req.json().catch(() => ({}))
  const provider = body.provider as AiProvider
  if (!(AI_PROVIDERS as readonly string[]).includes(provider)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 400 })
  }

  const cfg = await getAiConfig()
  const keys = { ...cfg.keys, ...(typeof body.key === 'string' && body.key.trim() ? { [provider]: body.key.trim() } : {}) }
  const models = { ...cfg.models, ...(typeof body.model === 'string' && body.model.trim() ? { [provider]: body.model.trim() } : {}) }
  if (!keys[provider]) return NextResponse.json({ ok: false, error: 'No API key for this provider' }, { status: 400 })

  const started = Date.now()
  try {
    const text = await pingProvider(provider, { ...cfg, keys, models })
    const parsed = parseJsonLoose<{ ok?: boolean }>(text)
    return NextResponse.json({ ok: !!parsed, ms: Date.now() - started })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Never echo the key back; provider errors don't include it.
    return NextResponse.json({ ok: false, error: msg.slice(0, 400), ms: Date.now() - started }, { status: 502 })
  }
}
