import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { EmptyAudienceError, parseAudience, prepareBroadcast } from '@/lib/broadcasts/audience'

/**
 * POST /api/broadcasts/prepare — admins.
 * { name, template_name, template_language?, variables, audience: AudienceConfig }
 * Resolves the audience (CSV phones not yet in contacts are created), creates
 * the broadcast with status "sending" and its pending recipients.
 * → { broadcast, recipients: [{ …recipient, contact }], custom_values: { [contactId]: { [fieldId]: value } } }
 * 422 { error } when the audience is empty. The wizard then sends in batches
 * through /api/whatsapp/broadcast and reports to /api/broadcasts/[id]/progress.
 */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 200) : ''
  const templateName = typeof body?.template_name === 'string' ? body.template_name.trim() : ''
  if (!name || !templateName) return NextResponse.json({ error: 'name and template_name are required' }, { status: 400 })
  const language = typeof body?.template_language === 'string' && body.template_language ? body.template_language : 'en_US'
  const variables = body?.variables && typeof body.variables === 'object' && !Array.isArray(body.variables) ? (body.variables as Record<string, unknown>) : {}
  const audience = parseAudience(body?.audience)
  if (!audience.ok) return NextResponse.json({ error: audience.error }, { status: 400 })

  const { db, workspace, user } = guard.ctx
  try {
    const { broadcast, recipients, customValues } = await prepareBroadcast(db, workspace.id, user.id, {
      name,
      templateName,
      templateLanguage: language,
      variables,
      audience: audience.value,
    })
    return NextResponse.json({ broadcast, recipients, custom_values: customValues })
  } catch (err) {
    if (err instanceof EmptyAudienceError) return NextResponse.json({ error: err.message }, { status: 422 })
    console.error('[broadcasts] prepare failed:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Failed to create broadcast' }, { status: 500 })
  }
}
