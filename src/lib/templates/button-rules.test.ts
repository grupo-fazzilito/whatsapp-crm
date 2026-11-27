import { describe, expect, it } from 'vitest'
import { parseButtonRules, ruleForButton } from './button-rules'

const buttons = [
  { type: 'quick_reply', text: 'Sí, quiero' },
  { type: 'quick_reply', text: 'No, gracias' },
  { type: 'url', text: 'Ver web' },
]

describe('template button rules', () => {
  it('keeps rules only for quick-reply buttons, trimmed, without empty ones', () => {
    expect(parseButtonRules({ 'sí, quiero': '  Envía el catálogo  ', 'No, gracias': ' ', 'Ver web': 'x', Otro: 'y' }, buttons)).toEqual({ 'Sí, quiero': 'Envía el catálogo' })
    expect(parseButtonRules({ 'Sí, quiero': 'a'.repeat(1500) }, buttons)!['Sí, quiero']).toHaveLength(1000)
  })

  it('refuses what is not a map of texts', () => {
    expect(parseButtonRules(null, buttons)).toBeNull()
    expect(parseButtonRules(['x'], buttons)).toBeNull()
    expect(parseButtonRules({ 'Sí, quiero': 3 }, buttons)).toBeNull()
  })

  it('finds the rule of the pressed button whatever the case', () => {
    expect(ruleForButton({ 'Sí, quiero': 'Envía el catálogo' }, ' SÍ, QUIERO ')).toEqual({ button: 'Sí, quiero', rule: 'Envía el catálogo' })
    expect(ruleForButton({ 'Sí, quiero': 'Envía el catálogo' }, 'No, gracias')).toBeNull()
    expect(ruleForButton(null, 'Sí, quiero')).toBeNull()
  })
})
