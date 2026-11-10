import { describe, expect, it } from 'vitest'
import { appendExtraInfo, crmPromptSection, describeActions, EXTRA_INFO_KEY, planContact, planDeal, planTags, planTask, type CrmContext } from './crm-model'

function ctx(over: Partial<CrmContext> = {}): CrmContext {
  return {
    stages: [
      { id: 's2', pipeline_id: 'p1', pipeline_name: 'Ventas', name: 'Interesado', position: 2, ai_hint: 'pregunta precio' },
      { id: 's3', pipeline_id: 'p1', pipeline_name: 'Ventas', name: 'Cotización', position: 3, ai_hint: 'recibió precio' },
    ],
    allStages: [
      { id: 's0', pipeline_id: 'p1', position: 0, name: 'Nuevo' },
      { id: 's2', pipeline_id: 'p1', position: 2, name: 'Interesado' },
      { id: 's3', pipeline_id: 'p1', position: 3, name: 'Cotización' },
    ],
    deals: [],
    tags: [
      { id: 't1', name: 'VIP', ai_hint: 'compra mucho' },
      { id: 't2', name: 'Ortodoncia', ai_hint: null },
    ],
    tagIds: [],
    fields: [
      { id: 'f1', field_name: 'Talla', field_type: 'select', field_options: ['S', 'M', 'L'], key: null },
      { id: 'f2', field_name: 'Cumpleaños', field_type: 'date', field_options: null, key: null },
      { id: 'fx', field_name: 'Más información del cliente', field_type: 'text', field_options: null, key: EXTRA_INFO_KEY },
    ],
    values: {},
    contact: { name: null, email: null, phone: '+51999888777', company: null },
    dealsManaged: false,
    ...over,
  }
}

describe('customer data', () => {
  it('fills empty data and keeps a different value in "Más información" instead of replacing it', () => {
    const plan = planContact(
      { name: 'Ana Pérez', email: 'ANA@mail.com', phone: '+51 911 222 333', fields: [{ field_id: 'f1', value: 'M' }], extra_info: 'Es alérgica a la penicilina' },
      ctx(),
      'es',
    )
    expect(plan.patch).toEqual({ name: 'Ana Pérez', email: 'ana@mail.com' })
    expect(plan.fields).toEqual({ f1: 'M' })
    expect(plan.extra).toEqual(['Otro teléfono: +51911222333', 'Es alérgica a la penicilina'])
    expect(plan.changed).toEqual(['name', 'email', 'Talla'])
  })

  it('never changes data on file, and ignores bad values', () => {
    const c = ctx({ contact: { name: 'Ana', email: 'ana@mail.com', phone: '+51999888777', company: 'ACME' }, values: { f1: 'S' } })
    const plan = planContact(
      { name: 'Ana', email: 'otra@mail.com', phone: '999888777', company: 'acme', fields: [{ field_id: 'f1', value: 'L' }, { field_id: 'f2', value: 'mañana' }, { field_id: 'fx', value: 'x' }, { field_id: 'nope', value: 'y' }] },
      c,
      'es',
    )
    expect(plan.patch).toEqual({})
    expect(plan.fields).toEqual({})
    expect(plan.extra).toEqual(['Otro correo: otra@mail.com', 'Talla: L'])
    expect(planContact({ email: 'no-es-correo', name: '+51 999' }, ctx(), 'es').changed).toEqual([])
  })

  it('a name that is only a phone number is replaced by the real one', () => {
    expect(planContact({ name: 'Luis' }, ctx({ contact: { name: '51999888777', email: null, phone: null, company: null } }), 'es').patch).toEqual({ name: 'Luis' })
  })

  it('appends dated lines without repeating them', () => {
    const first = appendExtraInfo(null, ['Talla M'], '2026-11-10')
    expect(first).toBe('2026-11-10: Talla M')
    expect(appendExtraInfo(first, ['talla m'], '2026-11-11')).toBeNull()
    expect(appendExtraInfo(first, ['Vive en Miraflores'], '2026-11-11')).toBe('2026-11-10: Talla M\n2026-11-11: Vive en Miraflores')
  })
})

describe('deals', () => {
  it('opens a deal at the chosen stage, then only moves it forward', () => {
    expect(planDeal({ deal_stage_id: 's2', deal_title: 'Ortodoncia' }, ctx())).toMatchObject({ kind: 'create', title: 'Ortodoncia', value: 0 })
    const withDeal = ctx({ deals: [{ id: 'd1', pipeline_id: 'p1', stage_id: 's2', title: 'Ortodoncia', value: 0 }] })
    expect(planDeal({ deal_stage_id: 's3', deal_value: 1200 }, withDeal)).toMatchObject({ kind: 'move', value: 1200 })
    expect(planDeal({ deal_stage_id: 's2' }, withDeal).kind).toBe('none')
    const further = ctx({ deals: [{ id: 'd1', pipeline_id: 'p1', stage_id: 's3', title: 'x', value: 0 }] })
    expect(planDeal({ deal_stage_id: 's2' }, further).kind).toBe('none')
  })

  it('ignores unknown stages and real estate (its own lead logic moves deals)', () => {
    expect(planDeal({ deal_stage_id: 's0' }, ctx()).kind).toBe('none')
    expect(planDeal({ deal_stage_id: 's2' }, ctx({ dealsManaged: true })).kind).toBe('none')
  })
})

describe('tags, tasks and the prompt', () => {
  it('adds known tags the customer does not have yet', () => {
    expect(planTags({ tag_ids: ['t1', 't1', 't2', 'zz'] }, ctx({ tagIds: ['t2'] })).map((t) => t.id)).toEqual(['t1'])
  })

  it('reads the task due date as local time', () => {
    const task = planTask({ task: { title: 'Llamar a Ana', due: '2026-11-12 15:30' } }, (d, t) => new Date(`${d}T${t}:00-05:00`))
    expect(task?.due?.toISOString()).toBe('2026-11-12T20:30:00.000Z')
    expect(planTask({ task: { title: ' ' } }, () => null)).toBeNull()
  })

  it('lists stages, tags and custom fields, without the system field', () => {
    const text = crmPromptSection(ctx(), '2026-11-10 10:00')
    expect(text).toContain('[s2] Ventas › Interesado: pregunta precio')
    expect(text).toContain('[t1] VIP — compra mucho')
    expect(text).toContain('[f1] Talla (select: S|M|L)')
    expect(text).not.toContain('[fx]')
    expect(crmPromptSection(ctx({ dealsManaged: true }), 'x')).not.toContain('CRM PIPELINE')
  })

  it('describes what was done', () => {
    expect(describeActions([{ kind: 'contact', changed: ['email'] }, { kind: 'deal_moved', stage: 'Cotización' }, { kind: 'note' }], 'es')).toBe(
      'datos: email; negocio → Cotización; nota resumen',
    )
  })
})
