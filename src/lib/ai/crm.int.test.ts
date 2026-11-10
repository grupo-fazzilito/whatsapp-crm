// The AI agent's CRM writes and the automatic facts (migration 32), against PostgreSQL:
// TEST_DATABASE_URL=postgresql://crm:crm@127.0.0.1:5434/crm_migrated npx vitest run src/lib/ai/crm
import { afterAll, describe, expect, it, vi } from 'vitest'
import { pgTest } from '@/lib/test-utils/pg'

vi.mock('server-only', () => ({}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }))
const pg = await pgTest()

describe.skipIf(!pg)('AI CRM actions', async () => {
  if (!pg) return
  const { loadCrmContext, applyAiCrm } = await import('./crm')
  const { creditBalance, grantCredits } = await import('@/lib/billing/credits')
  const ws = await pg.workspace({ businessType: 'clinic' })
  const W = ws.workspaceId
  afterAll(() => pg.cleanup(ws))
  await grantCredits({ workspaceId: W, amount: 100, source: 'grant', expiresAt: new Date(Date.now() + 86_400_000) })

  const contact = await ws.db.contacts.create({ data: { workspace_id: W, phone: '+51999888777', name: '51999888777' } })
  const conv = await ws.db.conversations.create({ data: { workspace_id: W, contact_id: contact.id } })
  const pipeline = await ws.db.pipelines.findFirstOrThrow({ where: { key: 'sales' }, include: { pipeline_stages: true } })
  const stage = (key: string) => pipeline.pipeline_stages.find((s) => s.key === key)!
  const tag = await ws.db.tags.create({ data: { workspace_id: W, name: 'Ortodoncia', ai_hint: 'pregunta por brackets' } })
  const size = await ws.db.custom_fields.create({ data: { workspace_id: W, field_name: 'Talla', field_type: 'text' } })

  it('the sales pipeline comes with meanings and facts for the AI', () => {
    expect(stage('interested').ai_hint).toMatch(/interés/)
    expect(stage('closing').ai_events).toEqual(['booking_created', 'order_created'])
    expect(stage('new').ai_hint).toBeNull()
  })

  it('writes data, deal, tag, task and note, and charges one credit per action', async () => {
    const ctx = (await loadCrmContext(W, contact.id, 'clinic'))!
    expect(ctx.stages.map((s) => s.id)).toContain(stage('interested').id)
    const before = await creditBalance(W)
    const done = await applyAiCrm({
      workspaceId: W,
      contactId: contact.id,
      conversationId: conv.id,
      lang: 'es',
      timeZone: 'America/Lima',
      currency: 'PEN',
      ctx,
      handover: true,
      crm: {
        contact: { name: 'Ana Pérez', email: 'ana@mail.com', phone: '+51 911 222 333', fields: [{ field_id: size.id, value: 'M' }], extra_info: 'Alérgica a la penicilina' },
        deal_stage_id: stage('interested').id,
        deal_title: 'Ortodoncia',
        tag_ids: [tag.id],
        task: { title: 'Llamar a Ana', due: '2026-11-12 15:30' },
        summary: 'Quiere brackets y pide que la llamen.',
      },
    })
    expect(done.map((a) => a.kind)).toEqual(['contact', 'deal_created', 'tag', 'task', 'note'])
    expect(await creditBalance(W)).toBe(before - 5)

    expect(await ws.db.contacts.findFirst({ where: { id: contact.id } })).toMatchObject({ name: 'Ana Pérez', email: 'ana@mail.com', phone: '+51999888777' })
    const extra = await ws.db.custom_fields.findFirstOrThrow({ where: { key: 'ai_extra_info' } })
    const values = await ws.db.contact_custom_values.findMany({ where: { contact_id: contact.id } })
    expect(values.find((v) => v.custom_field_id === size.id)?.value).toBe('M')
    expect(values.find((v) => v.custom_field_id === extra.id)?.value).toMatch(/Otro teléfono: \+51911222333\n.*Alérgica a la penicilina$/)

    const deal = await ws.db.deals.findFirstOrThrow({ where: { contact_id: contact.id } })
    expect(deal).toMatchObject({ stage_id: stage('interested').id, title: 'Ortodoncia', conversation_id: conv.id, currency: 'PEN' })
    const task = await ws.db.tasks.findFirstOrThrow({ where: { contact_id: contact.id } })
    expect(task).toMatchObject({ title: 'Llamar a Ana', deal_id: deal.id })
    expect(new Date(String(task.due_at)).toISOString()).toBe('2026-11-12T20:30:00.000Z')
    expect(await ws.db.contact_tags.count({ where: { contact_id: contact.id, tag_id: tag.id } })).toBe(1)
    expect((await ws.db.contact_notes.findFirstOrThrow({ where: { contact_id: contact.id } })).note_text).toBe('[IA] Quiere brackets y pide que la llamen.')
    const event = await ws.db.conversation_events.findFirstOrThrow({ where: { conversation_id: conv.id, type: 'ai_crm' } })
    expect(event.note).toContain('negocio nuevo en Interesado')
  })

  it('does not repeat itself on the next turn', async () => {
    const ctx = (await loadCrmContext(W, contact.id, 'clinic'))!
    const before = await creditBalance(W)
    const done = await applyAiCrm({
      workspaceId: W, contactId: contact.id, conversationId: conv.id, lang: 'es', timeZone: 'America/Lima', currency: 'PEN', ctx, handover: false,
      crm: { contact: { email: 'ana@mail.com', extra_info: 'Alérgica a la penicilina' }, deal_stage_id: stage('interested').id, tag_ids: [tag.id], task: { title: 'Llamar a Ana' }, summary: 'x' },
    })
    expect(done).toEqual([])
    expect(await creditBalance(W)).toBe(before)
  })

  it('a booking moves the same deal forward to the stage marked for it', async () => {
    await ws.db.bookings.create({ data: { workspace_id: W, contact_id: contact.id, conversation_id: conv.id, booking_date: '2026-11-20', booking_time: '10:00', status: 'confirmed' } })
    const deals = await ws.db.deals.findMany({ where: { contact_id: contact.id } })
    expect(deals).toHaveLength(1)
    expect(deals[0].stage_id).toBe(stage('closing').id)
    const auto = await ws.db.conversation_events.findMany({ where: { conversation_id: conv.id, type: 'ai_crm' }, orderBy: { created_at: 'desc' } })
    expect(auto[0].data).toMatchObject({ auto: true, fact: 'booking_created', actions: [{ kind: 'deal_moved', stage: stage('closing').name }] })

    // The AI can't take it back to an earlier stage.
    const ctx = (await loadCrmContext(W, contact.id, 'clinic'))!
    const done = await applyAiCrm({ workspaceId: W, contactId: contact.id, conversationId: conv.id, lang: 'es', timeZone: 'America/Lima', currency: 'PEN', ctx, handover: false, crm: { deal_stage_id: stage('proposal').id } })
    expect(done).toEqual([])
  })

  it('a fact opens a deal for a customer who has none', async () => {
    const other = await ws.db.contacts.create({ data: { workspace_id: W, name: 'Luis' } })
    await ws.db.bookings.create({ data: { workspace_id: W, contact_id: other.id, booking_date: '2026-11-21', booking_time: '11:00' } })
    expect(await ws.db.deals.findFirst({ where: { contact_id: other.id } })).toMatchObject({ title: 'Luis', stage_id: stage('closing').id })
  })
})
