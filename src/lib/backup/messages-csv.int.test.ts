// The conversations backup against a real PostgreSQL.
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/backup
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))

const pg = await pgTest()

describe.skipIf(!pg)('conversations backup CSV', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  const { backupStream } = await import('./messages-csv')
  const ws = await workspace({ name: 'Respaldo' })
  const other = await workspace({ name: 'Otro' })
  afterAll(async () => {
    await cleanup(ws, other)
    await prisma.$disconnect()
  })

  const seed = async (workspaceId: string, name: string) => {
    const contact = await prisma.contacts.create({ data: { workspace_id: workspaceId, name, phone: '+51911111111' } })
    const conv = await prisma.conversations.create({ data: { workspace_id: workspaceId, contact_id: contact.id, channel_type: 'whatsapp', channel_name: 'Tienda' } })
    return conv.id
  }
  const conv = await seed(ws.workspaceId, 'Ana, "la clienta"')
  const otherConv = await seed(other.workspaceId, 'Ajeno')
  const at = (iso: string) => new Date(iso)
  await prisma.messages.createMany({
    data: [
      { workspace_id: ws.workspaceId, conversation_id: conv, sender_type: 'customer', content_text: 'Hola\nquiero info', created_at: at('2026-11-01T15:00:00Z') },
      { workspace_id: ws.workspaceId, conversation_id: conv, sender_type: 'agent', sender_id: ws.userId, content_text: '=SUMA(1)', created_at: at('2026-11-02T15:00:00Z') },
      { workspace_id: ws.workspaceId, conversation_id: conv, sender_type: 'agent', content_text: 'nota del equipo', is_internal: true, created_at: at('2026-11-03T15:00:00Z') },
      { workspace_id: other.workspaceId, conversation_id: otherConv, sender_type: 'customer', content_text: 'no debe salir', created_at: at('2026-11-01T15:00:00Z') },
    ],
  })

  const read = async (opts: { from?: Date | null; to?: Date | null; includeInternal?: boolean } = {}) =>
    new Response(backupStream({ workspaceId: ws.workspaceId, from: opts.from ?? null, to: opts.to ?? null, includeInternal: opts.includeInternal ?? false, timeZone: 'America/Lima', lang: 'es', origin: 'https://x' })).arrayBuffer().then((b) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b))

  it("only this business's messages, oldest first, Excel-safe", async () => {
    const csv = await read()
    expect(csv.startsWith('﻿Fecha,Conversación,')).toBe(true)
    expect(csv).not.toContain('no debe salir')
    expect(csv).not.toContain('nota del equipo') // internal notes only when asked
    expect(csv).toContain('"Hola\nquiero info"')
    expect(csv).toContain('"Ana, ""la clienta"""')
    expect(csv).toContain("'=SUMA(1)") // no spreadsheet formulas
    expect(csv.indexOf('Hola')).toBeLessThan(csv.indexOf('SUMA'))
    expect(csv).toContain('2026-11-01 10:00:00') // Lima time
  })

  it('internal notes and a date range', async () => {
    expect(await read({ includeInternal: true })).toContain('nota del equipo')
    const csv = await read({ from: at('2026-11-02T05:00:00Z'), to: at('2026-11-03T05:00:00Z') })
    expect(csv).toContain('SUMA')
    expect(csv).not.toContain('Hola')
  })

  it('more messages than one batch arrive complete', async () => {
    const rows = Array.from({ length: 2100 }, (_, i) => ({ workspace_id: ws.workspaceId, conversation_id: conv, sender_type: 'customer', content_text: `m${i}`, created_at: at('2026-12-01T00:00:00Z') }))
    await prisma.messages.createMany({ data: rows })
    const csv = await read({ from: at('2026-11-30T00:00:00Z') })
    expect(csv.trim().split('\r\n')).toHaveLength(2101) // header + 2,100
  })
})
