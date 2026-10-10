import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireWorkspace } from '@/lib/workspace/context'
import { publicUrl, uploadObject } from '@/lib/storage'

// Header sample of a template (image / video / document). Stored in the
// public catalog bucket so the preview can show it; on submit it is
// uploaded to Meta as the review sample.
const TYPES: Record<string, { ext: string; max: number }> = {
  'image/jpeg': { ext: 'jpg', max: 5 * 1024 * 1024 },
  'image/png': { ext: 'png', max: 5 * 1024 * 1024 },
  'video/mp4': { ext: 'mp4', max: 16 * 1024 * 1024 },
  'application/pdf': { ext: 'pdf', max: 100 * 1024 * 1024 },
}

/** POST multipart { file } → { url } (admins). */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const form = await request.formData().catch(() => null)
  const file = form?.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file_required' }, { status: 400 })
  const type = TYPES[file.type]
  if (!type) return NextResponse.json({ error: 'unsupported_type' }, { status: 415 })
  if (file.size > type.max) return NextResponse.json({ error: 'file_too_large' }, { status: 413 })
  const path = `${guard.ctx.workspace.id}/templates/${randomUUID()}.${type.ext}`
  await uploadObject('catalog', path, Buffer.from(await file.arrayBuffer()), file.type)
  return NextResponse.json({ url: publicUrl('catalog', path) })
}
