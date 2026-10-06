import { NextResponse } from 'next/server'
import { tiktokEnabled } from '@/lib/channels/adapters/tiktok'

// TikTok Business Messaging webhooks. The API is in beta and gated by
// TikTok approval; the event format and signature scheme come with the
// access grant. Until then this endpoint refuses traffic explicitly so
// nothing is silently dropped.
export async function POST() {
  if (!tiktokEnabled()) {
    return NextResponse.json({ error: 'TikTok messaging is not enabled' }, { status: 501 })
  }
  return NextResponse.json({ error: 'TikTok webhook parser not implemented yet' }, { status: 501 })
}
