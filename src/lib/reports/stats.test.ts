import { describe, expect, it } from 'vitest'
import { median, percentile, ratio, sum } from './stats'

describe('percentile', () => {
  it('returns null for empty input', () => {
    expect(percentile([], 0.5)).toBeNull()
    expect(median([])).toBeNull()
  })
  it('interpolates like percentile_cont', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([5, 1, 3])).toBe(3)
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1)
    expect(percentile([7], 0.9)).toBe(7)
  })
  it('clamps p and does not mutate input', () => {
    const v = [3, 1, 2]
    expect(percentile(v, 2)).toBe(3)
    expect(percentile(v, -1)).toBe(1)
    expect(v).toEqual([3, 1, 2])
  })
})

describe('ratio / sum', () => {
  it('handles zero denominators', () => {
    expect(ratio(1, 0)).toBeNull()
    expect(ratio(1, 4)).toBe(0.25)
    expect(sum([1, 2, 3.5])).toBe(6.5)
  })
})
