// Platform webhooks against a real PostgreSQL: triggers queue platform and
// workspace events, the worker delivers them signed to a local receiver.
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/webhooks
import http from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }))

const pg = await pgTest()

describe.skipIf(!pg)('platform webhooks on PostgreSQL', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  process.env.ENCRYPTION_KEY ||= 'test-encryption-key-for-int-tests'
  const { encrypt } = await import('@/lib/whatsapp/encryption')
  const { verifySignature } = await import('./signature')
  const platform = await import('./platform')

  const received: { event: string; signature: string; body: string }[] = []
  let status = 200
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push({ event: String(req.headers['x-whasalia-event']), signature: String(req.headers['x-whasalia-signature']), body })
      res.statusCode = status
      res.end('ok')
    })
  })
  const secret = 'whsec_platform_test'
  let endpointId = ''
  let otherId = ''
  let ws: Awaited<ReturnType<typeof workspace>>

  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as AddressInfo).port
    // Isolate from endpoints other tests or people left behind.
    await prisma.platform_webhook_endpoints.updateMany({ data: { active: false } })
    const all = await prisma.platform_webhook_endpoints.create({ data: { url: `http://127.0.0.1:${port}/all`, events: ['*'], secret_encrypted: encrypt(secret) } })
    const tickets = await prisma.platform_webhook_endpoints.create({ data: { url: `http://127.0.0.1:${port}/tickets`, events: ['ticket.created'], secret_encrypted: encrypt(secret) } })
    endpointId = all.id
    otherId = tickets.id
    ws = await workspace({ name: 'Platform hooks' })
  })
  afterAll(async () => {
    await cleanup(ws)
    await prisma.platform_webhook_endpoints.deleteMany({ where: { id: { in: [endpointId, otherId] } } })
    server.close()
    await prisma.$disconnect()
  })

  const types = async (id: string) =>
    (await prisma.platform_webhook_deliveries.findMany({ where: { endpoint_id: id }, orderBy: { created_at: 'asc' } })).map((d) => d.event_type)

  it('queues platform events from triggers (sign-up, workspace, tickets, payments, tokens, channels)', async () => {
    const ticket = await prisma.support_tickets.create({ data: { workspace_id: ws.workspaceId, user_id: ws.userId, subject: 'No llegan mensajes', category: 'technical' } })
    await prisma.support_ticket_messages.create({ data: { ticket_id: ticket.id, workspace_id: ws.workspaceId, author_id: ws.userId, author_role: 'customer', body: 'Descripción' } })
    await prisma.support_ticket_messages.create({ data: { ticket_id: ticket.id, workspace_id: ws.workspaceId, author_id: ws.userId, author_role: 'support', body: 'Respuesta' } })
    await prisma.support_tickets.update({ where: { id: ticket.id }, data: { status: 'closed' } })
    const pay = await prisma.billing_payments.create({ data: { workspace_id: ws.workspaceId, provider: 'payment_latam', amount: 50, currency: 'PEN', credits: 1000, unit_price: 0.05, status: 'pending' } })
    await prisma.billing_payments.update({ where: { id: pay.id }, data: { status: 'paid', paid_at: new Date() } })
    const ch = await prisma.channels.create({ data: { workspace_id: ws.workspaceId, type: 'webchat', name: 'Web', external_id: `pk_test_${Date.now()}`, status: 'connected' } })
    await prisma.channels.update({ where: { id: ch.id }, data: { status: 'disconnected' } })

    const got = await types(endpointId)
    for (const t of ['user.signed_up', 'workspace.created', 'member.added', 'ticket.created', 'ticket.replied', 'ticket.status_changed', 'payment.created', 'payment.paid', 'channel.connected', 'channel.disconnected']) {
      expect(got, t).toContain(t)
    }
    // The ticket description is not a "reply": only one ticket.replied.
    expect(got.filter((t) => t === 'ticket.replied')).toHaveLength(1)
    // Endpoint subscribed to one event gets only that one.
    expect(await types(otherId)).toEqual(['ticket.created'])

    const replied = await prisma.platform_webhook_deliveries.findFirst({ where: { endpoint_id: endpointId, event_type: 'ticket.replied' } })
    const data = (replied!.payload as { workspace_id: string; data: { ticket: { subject: string }; message: { author_role: string } } })
    expect(data.workspace_id).toBe(ws.workspaceId)
    expect(data.data.ticket.subject).toBe('No llegan mensajes')
    expect(data.data.message.author_role).toBe('support')
  })

  it('also receives workspace events (orders, contacts) and app-code events', async () => {
    await ws.db.contacts.create({ data: { workspace_id: ws.workspaceId, name: 'Cliente', phone: `+51900${Date.now() % 1_000_000}` } })
    await platform.emitPlatformEvent(ws.workspaceId, 'tokens.low', { balance: 12 })
    const got = await types(endpointId)
    expect(got).toContain('contact.created')
    expect(got).toContain('tokens.low')
  })

  it('delivers signed envelopes in order and records the result', async () => {
    const pending = await prisma.platform_webhook_deliveries.count({ where: { endpoint_id: { in: [endpointId, otherId] }, status: 'pending' } })
    const stats = await platform.processPlatformWebhookDeliveries(500)
    expect(stats.delivered).toBe(pending)
    expect(received.length).toBe(pending)
    const first = received[0]
    expect(verifySignature(secret, first.body, first.signature)).toBeTruthy()
    const env = JSON.parse(first.body)
    expect(Object.keys(env)).toEqual(['id', 'type', 'created_at', 'workspace_id', 'data'])
    expect(await prisma.platform_webhook_deliveries.count({ where: { endpoint_id: endpointId, status: 'delivered' } })).toBeGreaterThan(5)
  })

  it('retries failures, test ping and resend', async () => {
    status = 500
    const ping = await platform.sendPlatformTestPing(endpointId)
    expect(ping).toMatchObject({ delivered: false, status: 500 })
    // A test ping does not count as an endpoint failure.
    expect((await prisma.platform_webhook_endpoints.findUnique({ where: { id: endpointId } }))!.failure_count).toBe(0)

    await platform.emitPlatformEvent(ws.workspaceId, 'tokens.depleted', { balance: 0 })
    await platform.processPlatformWebhookDeliveries(50)
    const failed = await prisma.platform_webhook_deliveries.findFirst({ where: { endpoint_id: endpointId, event_type: 'tokens.depleted' } })
    expect(failed).toMatchObject({ status: 'pending', attempts: 1, response_status: 500 })

    status = 200
    const again = await platform.resendPlatformDelivery(failed!.id)
    expect(again).toMatchObject({ delivered: true, status: 200 })
  })
})
