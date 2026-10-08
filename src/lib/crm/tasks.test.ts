import { describe, expect, it } from 'vitest'
import { dueBucket, fromLocalInput, groupByDue, inView, isOverdue, presetDue, sortTasks, toLocalInput } from './tasks'

// Wednesday 2026-10-07 10:30 local time.
const NOW = new Date(2026, 9, 7, 10, 30)
const at = (d: number, h = 9, m = 0) => new Date(2026, 9, d, h, m).toISOString()

describe('dueBucket', () => {
  it('classifies relative to now', () => {
    expect(dueBucket(null, NOW)).toBe('none')
    expect(dueBucket('garbage', NOW)).toBe('none')
    expect(dueBucket(at(7, 9), NOW)).toBe('overdue') // earlier today
    expect(dueBucket(at(6, 18), NOW)).toBe('overdue')
    expect(dueBucket(at(7, 18), NOW)).toBe('today')
    expect(dueBucket(at(7, 23, 59), NOW)).toBe('today')
    expect(dueBucket(at(8, 0), NOW)).toBe('tomorrow')
    expect(dueBucket(at(9, 12), NOW)).toBe('week')
    expect(dueBucket(at(14, 23), NOW)).toBe('week')
    expect(dueBucket(at(15, 0), NOW)).toBe('later')
  })
})

describe('isOverdue', () => {
  it('only open tasks with a past due date', () => {
    expect(isOverdue({ status: 'open', due_at: at(6) }, NOW)).toBe(true)
    expect(isOverdue({ status: 'done', due_at: at(6) }, NOW)).toBe(false)
    expect(isOverdue({ status: 'open', due_at: null }, NOW)).toBe(false)
    expect(isOverdue({ status: 'open', due_at: at(8) }, NOW)).toBe(false)
  })
})

describe('sortTasks / groupByDue', () => {
  const tasks = [
    { id: 'a', due_at: null, priority: 'urgent' as const },
    { id: 'b', due_at: at(8), priority: 'low' as const },
    { id: 'c', due_at: at(8), priority: 'urgent' as const },
    { id: 'd', due_at: at(5), priority: 'normal' as const },
    { id: 'e', due_at: at(7, 15), priority: 'normal' as const },
  ]
  it('sorts by due date, then priority, undated last', () => {
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['d', 'e', 'c', 'b', 'a'])
  })
  it('groups in bucket order', () => {
    const groups = groupByDue(tasks, NOW)
    expect(groups.map((g) => g.bucket)).toEqual(['overdue', 'today', 'tomorrow', 'none'])
    expect(groups[2].tasks.map((t) => t.id)).toEqual(['c', 'b'])
  })
})

describe('inView', () => {
  it('filters per tab', () => {
    const late = { status: 'open' as const, due_at: at(6) }
    const lateToday = { status: 'open' as const, due_at: at(7, 8) }
    const today = { status: 'open' as const, due_at: at(7, 17) }
    const next = { status: 'open' as const, due_at: at(10) }
    const undated = { status: 'open' as const, due_at: null }
    const done = { status: 'done' as const, due_at: at(6) }
    expect([late, lateToday, today, next, undated, done].map((t) => inView(t, 'open', NOW))).toEqual([true, true, true, true, true, false])
    expect([late, lateToday, today, next].map((t) => inView(t, 'overdue', NOW))).toEqual([true, true, false, false])
    expect([late, lateToday, today, next].map((t) => inView(t, 'today', NOW))).toEqual([false, true, true, false])
    expect([today, next, undated].map((t) => inView(t, 'upcoming', NOW))).toEqual([false, true, false])
    expect([late, done].map((t) => inView(t, 'done', NOW))).toEqual([false, true])
  })
})

describe('presetDue', () => {
  it('builds quick due dates', () => {
    expect(presetDue('none', NOW)).toBeNull()
    expect(presetDue('in1h', NOW)?.getTime()).toBe(NOW.getTime() + 3_600_000)
    expect(presetDue('today', NOW)).toEqual(new Date(2026, 9, 7, 18))
    expect(presetDue('tomorrow', NOW)).toEqual(new Date(2026, 9, 8, 9))
    expect(presetDue('next_week', NOW)).toEqual(new Date(2026, 9, 14, 9))
  })
  it('"today" after 18:00 falls back to one hour from now', () => {
    const late = new Date(2026, 9, 7, 19)
    expect(presetDue('today', late)?.getTime()).toBe(late.getTime() + 3_600_000)
  })
})

describe('datetime-local helpers', () => {
  it('round-trips local time', () => {
    const iso = new Date(2026, 9, 7, 8, 5).toISOString()
    expect(toLocalInput(iso)).toBe('2026-10-07T08:05')
    expect(fromLocalInput('2026-10-07T08:05')).toBe(iso)
    expect(toLocalInput(null)).toBe('')
    expect(fromLocalInput('')).toBeNull()
    expect(fromLocalInput('nope')).toBeNull()
  })
})
