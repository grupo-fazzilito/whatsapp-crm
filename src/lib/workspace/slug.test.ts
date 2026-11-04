import { describe, expect, it } from 'vitest'
import { normalizeSlug, slugProblem } from './slug'

describe('workspace slug', () => {
  it('turns a business name into an address', () => {
    expect(normalizeSlug('Barbería Léo & Co.')).toBe('barberia-leo-co')
    expect(normalizeSlug('  --Ñandú  Spa-- ')).toBe('nandu-spa')
    expect(normalizeSlug('x'.repeat(80))).toHaveLength(50)
    expect(normalizeSlug('a'.repeat(49) + ' b')).toBe('a'.repeat(49))
  })
  it('says why an address cannot be used', () => {
    expect(slugProblem('barberia-leo')).toBeNull()
    expect(slugProblem('ab')).toBe('short')
    expect(slugProblem('a'.repeat(51))).toBe('long')
    expect(slugProblem('barberia--leo')).toBe('format')
    expect(slugProblem('Barberia')).toBe('format')
    expect(slugProblem('-leo')).toBe('format')
    expect(slugProblem('admin')).toBe('reserved')
  })
})
