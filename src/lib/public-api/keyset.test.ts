import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { pgTest } from '@/lib/test-utils/pg'
import { encodeCursor } from './pagination'

// Real Postgres (TEST_DATABASE_URL); skipped without it.
const pg = await pgTest()
const { keysetPage } = pg ? await import('./keyset') : ({} as typeof import('./keyset'))
const { listContacts } = pg ? await import('./contacts') : ({} as typeof import('./contacts'))

describe.skipIf(!pg)('public API keyset pagination (Postgres)', () => {
  let ws: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let other: typeof ws
  // Expected order: created_at desc, id desc (computed by Postgres).
  let expected: string[] = []

  beforeAll(async () => {
    ws = await pg!.workspace()
    other = await pg!.workspace()
    // Several rows inside the same millisecond (microseconds apart), equal
    // timestamps (tie broken by id) and rows in other milliseconds.
    const stamps = [
      '2026-01-01 10:00:00.123900+00',
      '2026-01-01 10:00:00.123456+00',
      '2026-01-01 10:00:00.123456+00',
      '2026-01-01 10:00:00.123001+00',
      '2026-01-01 10:00:00.123000+00',
      '2026-01-01 10:00:00.122999+00',
      '2026-01-01 09:00:00+00',
    ]
    for (const [i, ts] of stamps.entries()) {
      const c = await ws.db.contacts.create({ data: { workspace_id: ws.workspaceId, name: `C${i}` } })
      await pg!.prisma.$executeRaw`UPDATE public.contacts SET created_at = ${ts}::timestamptz WHERE id = ${c.id}::uuid`
    }
    await other.db.contacts.create({ data: { workspace_id: other.workspaceId, name: 'other' } })
    const rows = await pg!.prisma.$queryRaw<{ id: string }[]>`
      SELECT id::text FROM public.contacts WHERE workspace_id = ${ws.workspaceId}::uuid ORDER BY created_at DESC, id DESC`
    expected = rows.map((r) => r.id)
  })

  afterAll(async () => {
    await pg!.cleanup(ws, other)
  })

  async function walk(limit: number, first?: string) {
    const seen: string[] = []
    let cursor: string | null | undefined = first
    for (let i = 0; i < 20; i++) {
      const url: URL = new URL(`https://x.test/api/v1/contacts?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`)
      const page: { data: { id: string }[]; next_cursor: string | null } = await keysetPage({
        workspaceId: ws.workspaceId,
        table: 'contacts',
        column: 'created_at',
        where: { workspace_id: ws.workspaceId },
        url,
        findMany: (args) => ws.db.contacts.findMany({ ...args, select: { id: true, created_at: true } }),
      })
      seen.push(...page.data.map((r) => r.id))
      cursor = page.next_cursor
      if (!cursor) break
    }
    return seen
  }

  it('walks every row exactly once in (created_at desc, id desc) order, across microsecond ties', async () => {
    for (const limit of [1, 2, 3, 7, 100]) {
      expect(await walk(limit)).toEqual(expected)
    }
  })

  it('keeps accepting cursors issued by PostgREST (microsecond offset format)', async () => {
    const row = await pg!.prisma.$queryRaw<{ v: string }[]>`
      SELECT to_json(created_at)#>>'{}' AS v FROM public.contacts WHERE id = ${expected[1]}::uuid`
    const cursor = encodeCursor({ v: row[0].v, id: expected[1] })
    expect(await walk(2, cursor)).toEqual(expected.slice(2))
  })

  it('rejects malformed cursors and limits like before', async () => {
    const bad = (q: string) =>
      keysetPage({
        workspaceId: ws.workspaceId,
        table: 'contacts',
        column: 'created_at',
        where: {},
        url: new URL(`https://x.test/?${q}`),
        findMany: (args) => ws.db.contacts.findMany({ ...args, select: { id: true, created_at: true } }),
      })
    await expect(bad('cursor=nope')).rejects.toThrow('invalid_cursor')
    await expect(bad('limit=0')).rejects.toThrow('invalid_limit')
  })

  it('listContacts filters by tag and embeds only that tag (as PostgREST !inner did)', async () => {
    const [a, b] = await ws.db.contacts.findMany({ where: { id: { in: expected.slice(0, 2) } }, orderBy: { name: 'asc' } })
    const t1 = await ws.db.tags.create({ data: { workspace_id: ws.workspaceId, name: 'vip', color: '#000000' } })
    const t2 = await ws.db.tags.create({ data: { workspace_id: ws.workspaceId, name: 'lead', color: '#ffffff' } })
    await ws.db.contact_tags.createMany({
      data: [
        { workspace_id: ws.workspaceId, contact_id: a.id, tag_id: t1.id },
        { workspace_id: ws.workspaceId, contact_id: a.id, tag_id: t2.id },
        { workspace_id: ws.workspaceId, contact_id: b.id, tag_id: t2.id },
      ],
    })
    const res = await listContacts(ws.workspaceId, new URL(`https://x.test/api/v1/contacts?tag_id=${t1.id}`))
    expect(res.next_cursor).toBeNull()
    expect(res.data).toHaveLength(1)
    expect(res.data[0]).toMatchObject({ id: a.id, tags: [{ id: t1.id, name: 'vip', color: '#000000' }] })

    const all = await listContacts(ws.workspaceId, new URL('https://x.test/api/v1/contacts?limit=100'))
    expect(all.data.map((c) => c.id)).toEqual(expected)
    expect(all.data.find((c) => c.id === a.id)!.tags.map((t) => t.name)).toEqual(['lead', 'vip'])
  })
})
