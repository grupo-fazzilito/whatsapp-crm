import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { FAQS_SCHEMA, MAX_TEXT, extract, faqsPrompt, importError, normalizeFaqs, saveFaqs } from '@/lib/business/importer'

/**
 * POST { text }                → { faqs: ImportedFaq[] } (preview, nothing saved)
 * POST { save: true, items }   → { inserted } (writes into `faqs`, available to all agents)
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace

  const body = (await request.json().catch(() => null)) as { text?: unknown; save?: unknown; items?: unknown } | null
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  if (body.save === true) {
    const items = normalizeFaqs(body.items)
    if (items.length === 0) return NextResponse.json({ error: 'Nothing to save' }, { status: 400 })
    try {
      return NextResponse.json({ inserted: await saveFaqs(ws.id, items) })
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : 'Save failed' }, { status: 500 })
    }
  }

  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (!text) return NextResponse.json({ error: 'Text to analyze is required' }, { status: 400 })
  if (text.length > MAX_TEXT) return NextResponse.json({ error: `Text is too long (max ${MAX_TEXT} characters)` }, { status: 400 })

  try {
    const raw = await extract(faqsPrompt(ws), text, FAQS_SCHEMA, 'faqs')
    return NextResponse.json({ faqs: normalizeFaqs(raw) })
  } catch (err) {
    return importError(err)
  }
}
