import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import type { Prisma } from '@/generated/prisma/client'
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
  const db = guard.ctx.db
  // Re-read so concurrent edits of other settings keys are kept.
  const ws = await db.workspaces.findFirst({ select: { settings: true }, where: { id: guard.ctx.workspace.id } }).catch(() => null)
  const settings = (ws?.settings ?? {}) as Record<string, unknown>
  const next = { ...aiAssistSettings(settings), ...patch }
  try {
    await db.workspaces.updateMany({
      where: { id: guard.ctx.workspace.id },
      data: { settings: { ...settings, ai_assist: next } as Prisma.InputJsonValue },
    })
  } catch {
    return NextResponse.json({ error: 'save_failed' }, { status: 500 })
  }
  return NextResponse.json({ settings: next })
}
