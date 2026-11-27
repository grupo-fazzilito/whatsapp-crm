// PDF report built in the background, against a real PostgreSQL.
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm STORAGE_DIR=/tmp/x npx vitest run src/lib/reports/exports
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => unknown) => void fn() }))

const pg = await pgTest()

describe.skipIf(!pg)('PDF report export', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  const { runReportExport } = await import('./exports')
  const { downloadObject } = await import('@/lib/storage')
  const ws = await workspace({ name: 'Reporte PDF' })
  afterAll(async () => {
    await cleanup(ws)
    await prisma.$disconnect()
  })

  it('builds the PDF, stores it privately and notifies the requester', async () => {
    const row = await prisma.report_exports.create({
      data: { workspace_id: ws.workspaceId, user_id: ws.userId, params: { preset: '7d', from: null, to: null, channelId: null, agentId: null, teamId: null, scope: 'workspace', locale: 'es' } },
    })
    await runReportExport(row.id)
    const done = await prisma.report_exports.findUniqueOrThrow({ where: { id: row.id } })
    expect(done.error).toBeNull()
    expect(done.status).toBe('ready')
    expect(done.file_name).toMatch(/^reporte-reporte-pdf-\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}\.pdf$/)
    const file = await downloadObject('attachments', done.file_path!)
    expect(file.body.subarray(0, 4).toString()).toBe('%PDF')
    const note = await prisma.notifications.findFirstOrThrow({ where: { workspace_id: ws.workspaceId, user_id: ws.userId, type: 'report' } })
    expect(note.link).toBe(`/api/reports/exports/${row.id}`)
    // Runs once: a second call does nothing.
    await runReportExport(row.id)
    expect(await prisma.notifications.count({ where: { workspace_id: ws.workspaceId, type: 'report' } })).toBe(1)
  }, 60_000)
})
