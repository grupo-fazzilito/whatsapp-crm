import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { mediaCapabilities } from '@/lib/ai/llm'
import { aiAssistSettings, parseAiAssistPatch } from '@/lib/ai/assist/core'

/**
 * GET → { settings: {auto_transcribe, auto_read_images}, capabilities: {text, audio, vision} }
 * (members; capabilities say which AI features the platform's providers allow)
 */
export async function GET() {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  return NextResponse.json({
    settings: aiAssistSettings(guard.ctx.workspace.settings),
    capabilities: await mediaCapabilities(),
  })
}

/** PATCH { auto_transcribe?: boolean, auto_read_images?: boolean } (admins) → { settings } */
export async function PATCH(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const patch = parseAiAssistPatch(await request.json().catch(() => null))
  if (!patch) return NextResponse.json({ error: 'invalid_body' }, { status: 400 })
  const db = supabaseAdmin()
  // Re-read so concurrent edits of other settings keys are kept.
  const { data: ws } = await db.from('workspaces').select('settings').eq('id', guard.ctx.workspace.id).single()
  const settings = (ws?.settings ?? {}) as Record<string, unknown>
  const next = { ...aiAssistSettings(settings), ...patch }
  const { error } = await db
    .from('workspaces')
    .update({ settings: { ...settings, ai_assist: next } })
    .eq('id', guard.ctx.workspace.id)
  if (error) return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  return NextResponse.json({ settings: next })
}
