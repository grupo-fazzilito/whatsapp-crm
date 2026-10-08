import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getLeadProfile } from '@/lib/real-estate/leads/service'
import { leadMatches, loadProperty, sendProperties } from '@/lib/real-estate/leads/properties'
import { propertyCurrency } from '@/lib/real-estate/leads/match'
import { propertyUrl } from '@/lib/real-estate/listing/url'
import { createTranslator } from '@/i18n/translate'

/**
 * GET  /api/real-estate/leads/[contactId]/matches
 *   → { matches: [{ id, name, price, currency, image, attributes, url, rank }] }
 *   Top 10 active listings for the contact's lead profile ("Coincidencias").
 * POST /api/real-estate/leads/[contactId]/matches { product_id, conversation_id }
 *   Sends the listing to the chat (photo card + link). → { ok }
 */
export async function GET(_req: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { supabase, workspace } = guard.ctx
  const { contactId } = await params
  if (!isUuid(contactId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })
  const { data: contact } = await supabase.from('contacts').select('id').eq('id', contactId).eq('workspace_id', workspace.id).maybeSingle()
  if (!contact) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const matches = await leadMatches(workspace.id, contactId)
  return NextResponse.json({
    matches: matches.map((m) => ({
      id: m.product.id,
      name: m.product.name,
      price: m.product.price,
      currency: propertyCurrency(m.product, workspace.currency),
      image: m.product.images[0] ?? null,
      attributes: m.product.attributes,
      url: propertyUrl(workspace, m.product),
      rank: m.rank,
    })),
  })
}

export async function POST(request: Request, { params }: { params: Promise<{ contactId: string }> }) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { workspace, user } = guard.ctx
  const { contactId } = await params
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
  const productId = typeof body?.product_id === 'string' ? body.product_id : ''
  const conversationId = typeof body?.conversation_id === 'string' ? body.conversation_id : ''
  if (!isUuid(contactId) || !isUuid(productId) || !isUuid(conversationId)) {
    return NextResponse.json({ error: 'product_id and conversation_id are required' }, { status: 400 })
  }
  const { data: conv } = await supabaseAdmin()
    .from('conversations')
    .select('id')
    .eq('id', conversationId)
    .eq('workspace_id', workspace.id)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (!conv) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const product = await loadProperty(workspace.id, productId)
  if (!product || !product.is_active) return NextResponse.json({ error: 'not_available' }, { status: 409 })

  const t = createTranslator(workspace.locale === 'en' ? 'en' : 'es')
  const lead = await getLeadProfile(workspace.id, contactId)
  const sent = await sendProperties(
    { workspaceId: workspace.id, conversationId, userId: user.id },
    [product],
    t('leads.server.sharedIntro'),
    'property_shared',
  )
  if (!sent) return NextResponse.json({ error: 'send_failed' }, { status: 502 })
  if (lead) {
    await supabaseAdmin()
      .from('lead_property_alerts')
      .upsert({ workspace_id: workspace.id, lead_profile_id: lead.id, product_id: product.id, delivery: 'customer' }, { onConflict: 'lead_profile_id,product_id', ignoreDuplicates: true })
  }
  return NextResponse.json({ ok: true })
}
