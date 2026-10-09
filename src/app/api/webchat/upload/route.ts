import { randomUUID } from 'crypto'
import { checkRateLimit, rateLimitResponse } from '@/lib/rate-limit'
import { uploadObject } from '@/lib/storage'
import {
  anyOriginCors,
  clientIp,
  preflight,
  resolveVisitor,
  visitorConversationId,
  wcJson,
  withCors,
} from '@/lib/webchat/server'

export const maxDuration = 30

const MAX_BYTES = 5 * 1024 * 1024
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }

/** The declared type has to match the file's magic bytes. */
function sniff(b: Uint8Array): string | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === 'RIFF' &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP'
  ) return 'image/webp'
  return null
}

export function OPTIONS(req: Request) {
  return preflight(req)
}

/**
 * POST /api/webchat/upload (multipart: visitor_token, file)
 * → {path}  — pass it to POST /api/webchat/messages as `image_path`.
 * JPEG/PNG/WebP only, ≤ 5 MB, stored in the private `attachments` bucket
 * under {workspace}/webchat/{conversation}/{uuid}.{ext}.
 */
export async function POST(req: Request) {
  const cors = anyOriginCors(req.headers.get('origin'))
  const ipRl = checkRateLimit(`wc:up:ip:${clientIp(req)}`, { limit: 30, windowMs: 10 * 60_000 })
  if (!ipRl.success) return withCors(rateLimitResponse(ipRl), req)

  const declared = Number(req.headers.get('content-length') || 0)
  if (declared > MAX_BYTES + 64 * 1024) return wcJson({ error: 'file_too_large', max: MAX_BYTES }, 413, cors)

  const form = await req.formData().catch(() => null)
  if (!form) return wcJson({ error: 'invalid_body' }, 400, cors)

  const v = await resolveVisitor(req, form.get('visitor_token'))
  if (!v.ok) return v.response

  const rl = checkRateLimit(`wc:up:v:${v.visitorId}`, { limit: 10, windowMs: 10 * 60_000 })
  if (!rl.success) return withCors(rateLimitResponse(rl), req)

  const file = form.get('file')
  if (!file || typeof file === 'string') return wcJson({ error: 'missing_file' }, 400, v.cors)
  if (file.size > MAX_BYTES) return wcJson({ error: 'file_too_large', max: MAX_BYTES }, 413, v.cors)
  if (!file.size) return wcJson({ error: 'empty_file' }, 400, v.cors)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const type = sniff(bytes)
  if (!type || !EXT[file.type] || type !== file.type) return wcJson({ error: 'unsupported_type' }, 415, v.cors)

  const conversationId = await visitorConversationId(v.channel, v.visitorId)
  if (!conversationId) return wcJson({ error: 'no_conversation' }, 409, v.cors)

  const path = `${v.channel.workspace_id}/webchat/${conversationId}/${randomUUID()}.${EXT[type]}`
  try {
    await uploadObject('attachments', path, bytes, type)
  } catch (err) {
    console.error('[webchat/upload] storage failed:', err instanceof Error ? err.message : err)
    return wcJson({ error: 'store_failed' }, 500, v.cors)
  }
  return wcJson({ path }, 200, v.cors)
}
