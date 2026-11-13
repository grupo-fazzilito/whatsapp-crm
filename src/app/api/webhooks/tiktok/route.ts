import { NextResponse, after } from 'next/server'
import { tiktokAppConfig } from '@/lib/tiktok/config'
import { parseCommentUpdate, verifyTiktokSignature } from '@/lib/tiktok/model'
import { handleTiktokCommentEvent } from '@/lib/tiktok/comments'

// TikTok API for Business webhooks (one callback URL per developer app,
// set with /business/webhook/update/). Every delivery is signed with the
// app secret ("Tiktok-Signature: t=…,s=…"); unsigned or stale ones are refused.
//   comment.update → comment rules (Accounts API).
//   Business Messaging events: not handled yet (that API is a separate approval).
export async function POST(request: Request) {
  const cfg = tiktokAppConfig()
  if (!cfg) return NextResponse.json({ error: 'TikTok is not configured' }, { status: 503 })

  const raw = await request.text()
  if (!verifyTiktokSignature(raw, request.headers.get('tiktok-signature'), cfg.appSecret)) {
    console.warn('[tiktok-webhook] bad signature', request.headers.get('x-tt-logid') ?? '')
    return NextResponse.json({ error: 'invalid signature' }, { status: 401 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid body' }, { status: 400 })
  }

  const comment = parseCommentUpdate(body)
  if (comment) {
    after(() =>
      handleTiktokCommentEvent(comment).catch((err) => console.error('[tiktok-webhook] comment failed:', err instanceof Error ? err.message : err)),
    )
  }
  // Answer fast: TikTok retries deliveries that don't get a 2xx.
  return NextResponse.json({ ok: true })
}
