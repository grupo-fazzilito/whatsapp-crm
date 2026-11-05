import { NextResponse } from 'next/server'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { loadChannel } from '@/lib/channels/store'
import { catalogAuth, linkedCatalog, listCatalogs } from '@/lib/meta-catalog/graph'
import { graphErrorCode } from '@/lib/meta-catalog/connection'

/** GET ?channel_id= (admin) → { linked, catalogs } — Meta catalogs of the business that owns that WhatsApp number. */
export async function GET(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const id = new URL(request.url).searchParams.get('channel_id') ?? ''
  const channel = isUuid(id) ? await loadChannel(guard.ctx.workspace.id, id) : null
  if (!channel || channel.type !== 'whatsapp') return NextResponse.json({ error: 'channel' }, { status: 400 })
  try {
    const auth = catalogAuth(channel)
    const [linked, catalogs] = await Promise.all([linkedCatalog(auth), listCatalogs(auth)])
    return NextResponse.json({ linked, catalogs })
  } catch (err) {
    return NextResponse.json({ error: graphErrorCode(err) }, { status: 502 })
  }
}
