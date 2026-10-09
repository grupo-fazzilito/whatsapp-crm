import { NextResponse } from 'next/server'
import type { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'

const MAX_PAGE_SIZE = 100

/**
 * GET /api/contacts?page=0&page_size=25&search=… — any member.
 * Newest first; `search` matches name, phone or email (case-insensitive).
 * → { contacts, count (all matches), contact_tags: {contact_id, tag_id}[] of the returned contacts }
 */
export async function GET(request: Request) {
  const guard = await requireWorkspace('agent')
  if (!guard.ok) return guard.response
  const { db } = guard.ctx

  const url = new URL(request.url)
  const page = Math.max(0, Math.floor(Number(url.searchParams.get('page')) || 0))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(url.searchParams.get('page_size')) || 25)))
  const search = (url.searchParams.get('search') ?? '').trim().slice(0, 200)

  const where: Prisma.contactsWhereInput = search
    ? {
        OR: [
          { name: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search, mode: 'insensitive' } },
          { email: { contains: search, mode: 'insensitive' } },
        ],
      }
    : {}

  try {
    const [contacts, count] = await Promise.all([
      db.contacts.findMany({ where, orderBy: { created_at: 'desc' }, skip: page * pageSize, take: pageSize }),
      db.contacts.count({ where }),
    ])
    const contactTags = contacts.length
      ? await db.contact_tags.findMany({
          select: { contact_id: true, tag_id: true },
          where: { contact_id: { in: contacts.map((c) => c.id) } },
        })
      : []
    return NextResponse.json({ contacts, count, contact_tags: contactTags })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
