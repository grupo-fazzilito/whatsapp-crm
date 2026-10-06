import { describe, expect, it } from 'vitest'
import { optionSlug, parseWelcomeMenu } from './welcome-menu'

const agent = (agent_id: string) => ({ type: 'agent', agent_id })

describe('parseWelcomeMenu', () => {
  it('null removes the menu', () => {
    expect(parseWelcomeMenu(null)).toEqual({ ok: true, menu: null, agentIds: [], assigneeIds: [] })
  })

  it('normalizes a valid menu and collects references', () => {
    const r = parseWelcomeMenu({
      enabled: true,
      question: '  ¿Qué estás buscando?  ',
      options: [
        { label: 'Productos', target: agent('a1') },
        { id: 'soporte', label: 'Soporte', description: 'Ayuda técnica', target: agent('a2') },
        { label: 'Planificación', target: { type: 'human', assignee_user_id: 'u1' } },
      ],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.menu).toEqual({
      enabled: true,
      question: '¿Qué estás buscando?',
      options: [
        { id: 'productos', label: 'Productos', target: { type: 'agent', agent_id: 'a1' } },
        { id: 'soporte', label: 'Soporte', description: 'Ayuda técnica', target: { type: 'agent', agent_id: 'a2' } },
        { id: 'planificacion', label: 'Planificación', target: { type: 'human', assignee_user_id: 'u1' } },
      ],
    })
    expect(r.agentIds).toEqual(['a1', 'a2'])
    expect(r.assigneeIds).toEqual(['u1'])
  })

  it('applies the button (≤20) vs list (≤24) label limits', () => {
    const label = 'x'.repeat(22)
    expect(parseWelcomeMenu({ enabled: true, question: 'q', options: [{ label, target: agent('a') }] }).ok).toBe(false)
    const four = Array.from({ length: 4 }, (_, i) => ({ label: `${label}${i}`, target: agent('a') }))
    expect(parseWelcomeMenu({ enabled: true, question: 'q', options: four }).ok).toBe(true)
    const tooLong = [...four.slice(0, 3), { label: 'y'.repeat(25), target: agent('a') }]
    expect(parseWelcomeMenu({ enabled: true, question: 'q', options: tooLong }).ok).toBe(false)
  })

  it('caps options at 10 and rejects bad targets / duplicate explicit ids', () => {
    const eleven = Array.from({ length: 11 }, (_, i) => ({ label: `O${i}`, target: agent('a') }))
    expect(parseWelcomeMenu({ enabled: true, question: 'q', options: eleven }).ok).toBe(false)
    expect(parseWelcomeMenu({ enabled: true, question: 'q', options: [{ label: 'A', target: { type: 'bot' } }] }).ok).toBe(false)
    expect(parseWelcomeMenu({ enabled: true, question: 'q', options: [{ label: 'A', target: { type: 'agent' } }] }).ok).toBe(false)
    expect(
      parseWelcomeMenu({
        enabled: true,
        question: 'q',
        options: [
          { id: 'a', label: 'A', target: agent('x') },
          { id: 'a', label: 'B', target: agent('x') },
        ],
      }).ok,
    ).toBe(false)
  })

  it('de-duplicates generated ids', () => {
    const r = parseWelcomeMenu({ enabled: true, question: 'q', options: [{ label: 'Ventas', target: agent('a') }, { label: 'ventas!', target: agent('b') }] })
    expect(r.ok && r.menu?.options.map((o) => o.id)).toEqual(['ventas', 'ventas_2'])
  })

  it('needs a question and options only when enabled', () => {
    expect(parseWelcomeMenu({ enabled: true, question: '', options: [{ label: 'A', target: agent('a') }] }).ok).toBe(false)
    expect(parseWelcomeMenu({ enabled: true, question: 'q', options: [] }).ok).toBe(false)
    expect(parseWelcomeMenu({ enabled: false, question: '', options: [] }).ok).toBe(true)
  })
})

describe('optionSlug', () => {
  it('makes short ascii slugs', () => {
    expect(optionSlug('Soporte técnico')).toBe('soporte_tecnico')
    expect(optionSlug('¿¿??')).toBe('opcion')
  })
})
