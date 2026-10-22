// Super admin notifications fed by platform events, against a real Postgres.
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/admin/notifications
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
const pg = await pgTest()

describe.skipIf(!pg)('platform notifications', async () => {
  if (!pg) return
  const p = pg.prisma
  const ws = await pg.workspace({ name: 'Panadería Notif' })
  const of = (type: string) => p.platform_notifications.findMany({ where: { type, workspace_id: ws.workspaceId } })
  const created: string[] = []

  afterAll(async () => {
    await p.platform_notifications.deleteMany({ where: { OR: [{ workspace_id: ws.workspaceId }, { id: { in: created } }] } })
    await p.platform_settings.deleteMany({ where: { key: 'admin_notifications' } })
    await pg.cleanup(ws)
  })

  it('a new business notifies, with its name', async () => {
    const rows = await of('workspace.created')
    expect(rows).toHaveLength(1)
    expect(rows[0].data).toMatchObject({ workspace: { name: 'Panadería Notif' } })
  })

  it('tickets notify when created and when the customer replies, not on the admin answer', async () => {
    const ticket = await p.support_tickets.create({ data: { workspace_id: ws.workspaceId, user_id: ws.userId, subject: 'No llegan mensajes' }, select: { id: true } })
    await p.support_ticket_messages.create({ data: { ticket_id: ticket.id, workspace_id: ws.workspaceId, author_id: ws.userId, author_role: 'customer', body: 'Ayuda' } })
    await p.support_ticket_messages.create({ data: { ticket_id: ticket.id, workspace_id: ws.workspaceId, author_role: 'support', body: 'Lo revisamos' } })
    await p.support_ticket_messages.create({ data: { ticket_id: ticket.id, workspace_id: ws.workspaceId, author_id: ws.userId, author_role: 'customer', body: 'Gracias' } })
    expect(await of('ticket.created')).toHaveLength(1)
    const replies = await of('ticket.replied')
    expect(replies).toHaveLength(1)
    expect(replies[0].data).toMatchObject({ message: { author_role: 'customer', body: 'Gracias' } })
  })

  it('a complaint notifies (no business attached)', async () => {
    const c = await p.complaints.create({
      data: {
        year: 2099, number: 9001, kind: 'reclamo', consumer_name: 'Juan Pérez', doc_type: 'dni', doc_number: '12345678',
        address: 'Lima', email: 'juan@example.com', item_type: 'servicio', item_description: 'Plan', detail: 'x', request: 'y',
      },
      select: { id: true },
    })
    const row = await p.platform_notifications.findFirstOrThrow({ where: { type: 'complaint.created', data: { path: ['complaint', 'id'], equals: c.id } } })
    created.push(row.id)
    await p.complaints.deleteMany({ where: { id: c.id } })
  })

  it('a disabled type stops notifying; tokens.low is off by default', async () => {
    await p.$executeRaw`SELECT public.platform_notify(${ws.workspaceId}::uuid, 'tokens.low', '{"balance": 3}'::jsonb)`
    expect(await of('tokens.low')).toHaveLength(0)
    await p.platform_settings.create({ data: { key: 'admin_notifications', value: { disabled: ['channel.connected'] } } })
    await p.channels.create({ data: { workspace_id: ws.workspaceId, type: 'webchat', name: 'Web', external_id: `pk_notif_${ws.workspaceId}` } })
    expect(await of('channel.connected')).toHaveLength(0)
    await p.$executeRaw`SELECT public.platform_notify(${ws.workspaceId}::uuid, 'tokens.low', '{"balance": 3}'::jsonb)`
    expect(await of('tokens.low')).toHaveLength(1)
  })
})
