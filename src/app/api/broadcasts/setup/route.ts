import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'

const PARTS = ['templates', 'tags', 'custom_fields', 'sample'] as const
type Part = (typeof PARTS)[number]

/**
 * GET /api/broadcasts/setup?include=templates,tags,custom_fields,sample — any member.
 * Lookups for the broadcast wizard; only the requested keys come back:
 *   templates      every message template, newest first
 *   tags           workspace tags by name
 *   custom_fields  custom fields by field_name
 *   sample         { contact, custom_values: [{custom_field_id, value}] } — newest contact, for the preview
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx
  const wanted = new Set(
    (new URL(request.url).searchParams.get('include') ?? '').split(',').filter((p): p is Part => (PARTS as readonly string[]).includes(p)),
  )
  try {
    const out: Record<string, unknown> = {}
    await Promise.all([
      wanted.has('templates') && db.message_templates.findMany({ orderBy: { created_at: 'desc' } }).then((r) => (out.templates = r)),
      wanted.has('tags') && db.tags.findMany({ orderBy: { name: 'asc' } }).then((r) => (out.tags = r)),
      wanted.has('custom_fields') && db.custom_fields.findMany({ orderBy: { field_name: 'asc' } }).then((r) => (out.custom_fields = r)),
      wanted.has('sample') &&
        (async () => {
          const contact = await db.contacts.findFirst({ orderBy: { created_at: 'desc' } })
          const custom_values = contact
            ? await db.contact_custom_values.findMany({ select: { custom_field_id: true, value: true }, where: { contact_id: contact.id } })
            : []
          out.sample = { contact, custom_values }
        })(),
    ])
    return NextResponse.json(out)
  } catch (err) {
    console.error('[broadcasts] setup failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Failed to load broadcast data' }, { status: 500 })
  }
}
