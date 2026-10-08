import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import {
  MAX_TEXT,
  SERVICES_SCHEMA,
  extract,
  importError,
  normalizeServices,
  saveServices,
  servicesPrompt,
} from '@/lib/business/importer'

/**
 * POST { text }                → { services: ImportedService[] } (preview, nothing saved)
 * POST { save: true, items }   → { inserted } (writes into `services`)
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace

  const body = (await request.json().catch(() => null)) as { text?: unknown; save?: unknown; items?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  if (body.save === true) {
    const items = normalizeServices(body.items)
    if (items.length === 0) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
    try {
      return NextResponse.json({ inserted: await saveServices(ws.id, items) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 })
    }
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Text to analyze is required' }, { status: 400 })
  if (text.length > MAX_TEXT) return NextResponse.json({ error: `Text is too long (max ${MAX_TEXT} characters)` }, { status: 400 })

  try {
    const raw = await extract(servicesPrompt(ws), text, SERVICES_SCHEMA, 'services', ws.id)
    return NextResponse.json({ services: normalizeServices(raw) })
  } catch (err) {
    return importError(err)
  }
}
