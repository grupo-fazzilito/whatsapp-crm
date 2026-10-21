import { describe, expect, it } from 'vitest'
import { normalizeValue, optionsOf, parseFieldInput } from './custom-fields'

describe('custom fields', () => {
  it('validates a field definition', () => {
    expect(parseFieldInput({ field_name: ' Ciudad ', field_type: 'text' })).toEqual({ ok: true, field: { field_name: 'Ciudad', field_type: 'text', field_options: null } })
    expect(parseFieldInput({ field_name: 'Plan', field_type: 'select', field_options: ['Básico', ' Pro ', 'Pro', ''] })).toEqual({
      ok: true,
      field: { field_name: 'Plan', field_type: 'select', field_options: ['Básico', 'Pro'] },
    })
    expect(parseFieldInput({ field_name: '', field_type: 'text' })).toEqual({ ok: false, error: 'name' })
    expect(parseFieldInput({ field_name: 'x', field_type: 'color' })).toEqual({ ok: false, error: 'type' })
    expect(parseFieldInput({ field_name: 'x', field_type: 'select', field_options: [] })).toEqual({ ok: false, error: 'options' })
  })

  it('keeps only values that fit the field type', () => {
    expect(normalizeValue({ field_type: 'number' }, '12,5')).toBe('12.5')
    expect(normalizeValue({ field_type: 'number' }, 'doce')).toBeNull()
    expect(normalizeValue({ field_type: 'date' }, '2026-10-21')).toBe('2026-10-21')
    expect(normalizeValue({ field_type: 'date' }, '21/10/2026')).toBeNull()
    expect(normalizeValue({ field_type: 'boolean' }, 'true')).toBe('true')
    expect(normalizeValue({ field_type: 'select', field_options: ['A', 'B'] }, 'B')).toBe('B')
    expect(normalizeValue({ field_type: 'select', field_options: ['A', 'B'] }, 'C')).toBeNull()
    expect(normalizeValue({ field_type: 'text' }, '  hola ')).toBe('hola')
    expect(normalizeValue({ field_type: 'text' }, '   ')).toBeNull()
  })

  it('reads select options defensively', () => {
    expect(optionsOf({ field_options: ['A', 1, '', 'B'] })).toEqual(['A', 'B'])
    expect(optionsOf({ field_options: { a: 1 } })).toEqual([])
  })
})
