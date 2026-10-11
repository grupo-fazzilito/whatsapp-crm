// Template save → submit to Meta → review webhook → edit → delete, against a
// real PostgreSQL and a local fake of the Graph API (META_GRAPH_MOCK_URL).
//   TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm npx vitest run src/lib/templates
import http from 'http'
import type { AddressInfo } from 'net'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }), headers: async () => new Headers() }))

const pg = await pgTest()

describe.skipIf(!pg)('message templates submitted to Meta', async () => {
  if (!pg) return
  const { prisma, workspace, cleanup } = pg
  process.env.ENCRYPTION_KEY ||= 'test-encryption-key-for-int-tests'

  const calls: { method: string; url: string; body: unknown }[] = []
  let reject = false
  const graph = http.createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      let body: unknown = raw
      try {
        body = JSON.parse(raw)
      } catch {}
      calls.push({ method: req.method ?? '', url: req.url ?? '', body })
      res.setHeader('Content-Type', 'application/json')
      if (reject) {
        res.statusCode = 400
        return res.end(JSON.stringify({ error: { message: 'Invalid parameter', error_user_msg: 'El cuerpo no puede empezar con una variable', code: 100 } }))
      }
      if (req.method === 'POST' && req.url?.includes('/message_templates')) return res.end(JSON.stringify({ id: '9001', status: 'PENDING', category: 'UTILITY' }))
      res.end(JSON.stringify({ success: true }))
    })
  })

  let ws: Awaited<ReturnType<typeof workspace>>
  let server: typeof import('./server')
  let meta: typeof import('./meta')

  beforeAll(async () => {
    await new Promise<void>((r) => graph.listen(0, '127.0.0.1', r))
    process.env.META_GRAPH_MOCK_URL = `http://127.0.0.1:${(graph.address() as AddressInfo).port}`
    server = await import('./server')
    meta = await import('./meta')
    ws = await workspace({ name: 'Templates' })
    const ch = await ws.db.channels.create({ data: { workspace_id: ws.workspaceId, type: 'whatsapp', name: 'WA', external_id: `pnid_${Date.now()}`, status: 'connected', settings: { waba_id: 'waba_1' } } })
    const { saveChannelSecrets } = await import('@/lib/channels/store')
    await saveChannelSecrets(ch.id, { access_token: 'token_1' })
  })
  afterAll(async () => {
    await cleanup(ws)
    graph.close()
    await prisma.$disconnect()
  })

  const draft = {
    name: 'confirmacion_pedido_test',
    category: 'Utility' as const,
    language: 'es',
    header: { type: 'none' as const },
    body: 'Hola {{nombre_cliente}}, tu pedido {{numero_pedido}} está listo para recoger.',
    footer: 'Gracias por tu compra',
    buttons: [{ type: 'quick_reply' as const, text: 'Ok' }],
    variables: [
      { key: 'nombre_cliente', label: 'Nombre del cliente', example: 'María', source: 'contact.name' as const },
      { key: 'numero_pedido', label: 'Número de pedido', example: '#1024', source: 'manual' as const },
    ],
  }
  let id = ''

  it('saves a draft in positional form and gives the editor its named draft back', async () => {
    const out = await server.saveTemplate({ db: ws.db, workspaceId: ws.workspaceId, userId: ws.userId, draft, submit: false })
    expect(out.ok).toBe(true)
    if (!out.ok) return
    id = out.template.id as string
    expect(out.template).toMatchObject({ status: 'Draft', body_text: 'Hola {{1}}, tu pedido {{2}} está listo para recoger.' })
    expect((out.template.draft as { body: string }).body).toBe(draft.body)
    expect(calls).toHaveLength(0)
  })

  it('rejects an invalid draft before calling Meta', async () => {
    const out = await server.saveTemplate({ db: ws.db, workspaceId: ws.workspaceId, userId: ws.userId, draft: { ...draft, name: 'otra', body: '{{nombre_cliente}} hola' }, submit: true })
    expect(out).toMatchObject({ ok: false, status: 422 })
  })

  it('submits to Meta with examples and stores the Meta id as Pending', async () => {
    const out = await server.saveTemplate({ db: ws.db, workspaceId: ws.workspaceId, userId: ws.userId, draft, id, submit: true })
    expect(out).toMatchObject({ ok: true, submitted: true })
    const call = calls.at(-1)!
    expect(call.url).toBe('/waba_1/message_templates')
    expect(call.body).toMatchObject({
      name: 'confirmacion_pedido_test',
      category: 'UTILITY',
      components: [{ type: 'BODY', text: 'Hola {{1}}, tu pedido {{2}} está listo para recoger.', example: { body_text: [['María', '#1024']] } }, { type: 'FOOTER' }, { type: 'BUTTONS' }],
    })
    const row = await ws.db.message_templates.findFirst({ where: { id } })
    expect(row).toMatchObject({ status: 'Pending', meta_template_id: '9001' })
    // In review: it can't be edited until Meta answers.
    expect(await server.saveTemplate({ db: ws.db, workspaceId: ws.workspaceId, userId: ws.userId, draft, id, submit: false })).toMatchObject({ ok: false, status: 409 })
  })

  it('applies review results from the webhook', async () => {
    await meta.applyTemplateStatusUpdate({ metaId: '9001', event: 'REJECTED', reason: 'INCORRECT_CATEGORY' })
    expect(await ws.db.message_templates.findFirst({ where: { id } })).toMatchObject({ status: 'Rejected', rejection_reason: 'INCORRECT_CATEGORY' })
  })

  it('re-submits an edited rejected template and reports Meta errors', async () => {
    const edited = { ...draft, body: 'Hola {{nombre_cliente}}, tu pedido {{numero_pedido}} ya está listo.' }
    const ok = await server.saveTemplate({ db: ws.db, workspaceId: ws.workspaceId, userId: ws.userId, draft: edited, id, submit: true })
    expect(ok).toMatchObject({ ok: true, submitted: true })
    expect(calls.at(-1)!.url).toBe('/9001')
    expect(await ws.db.message_templates.findFirst({ where: { id } })).toMatchObject({ status: 'Pending', rejection_reason: null })

    await meta.applyTemplateStatusUpdate({ metaId: '9001', event: 'APPROVED' })
    reject = true
    const failed = await server.saveTemplate({ db: ws.db, workspaceId: ws.workspaceId, userId: ws.userId, draft: edited, id, submit: true })
    expect(failed).toMatchObject({ ok: true, submitted: false, error: 'El cuerpo no puede empezar con una variable' })
    reject = false
  })

  it('deletes in Meta by name and id', async () => {
    const channel = (await import('@/lib/channels/store')).defaultChannel
    const ch = await channel(ws.workspaceId, 'whatsapp')
    await meta.deleteTemplate(ch!, 'confirmacion_pedido_test', '9001')
    expect(calls.at(-1)).toMatchObject({ method: 'DELETE', url: '/waba_1/message_templates?name=confirmacion_pedido_test&hsm_id=9001' })
  })
})
