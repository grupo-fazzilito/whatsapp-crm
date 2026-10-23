import { describe, expect, it } from 'vitest'
import { chosenOption, daysWithTimes, parseFieldAnswer, parsePickerReply, pickerReplyId, row, shortDay, timePage } from './picker-model'

describe('booking picker model', () => {
  it('round-trips reply ids', () => {
    expect(parsePickerReply(pickerReplyId('time', '10:30'))).toEqual({ step: 'time', value: '10:30' })
    expect(parsePickerReply(pickerReplyId('day', '2026-10-23'))).toEqual({ step: 'day', value: '2026-10-23' })
    expect(parsePickerReply('bk:nope:1')).toBeNull()
    expect(parsePickerReply('visit:book:1')).toBeNull()
  })

  it('takes a tap only on the step it belongs to, and typed answers', () => {
    const state = { step: 'time' as const, options: [row('09:00', '09:00'), row('09:30', '09:30'), row('more:9', 'Más horarios')] }
    expect(chosenOption(state, { replyId: 'bk:time:09:30' })?.id).toBe('09:30')
    // A day list tapped while choosing the time is ignored.
    expect(chosenOption(state, { replyId: 'bk:day:2026-10-23', text: 'jue 23 oct' })).toBeNull()
    expect(chosenOption(state, { text: '2' })?.id).toBe('09:30')
    expect(chosenOption(state, { text: '9.30' })?.id).toBe('09:30')
    expect(chosenOption(state, { text: 'más horarios' })?.id).toBe('more:9')
    expect(chosenOption(state, { text: '¿cuánto cuesta?' })).toBeNull()
  })

  it('keeps list rows within WhatsApp limits', () => {
    const r = row('x', 'Corte de cabello con lavado y masaje', '45 min')
    expect(r.title.length).toBeLessThanOrEqual(24)
    expect(r.description).toBe('Corte de cabello con lavado y masaje · 45 min')
    expect(row('x', 'Corte', '30 min')).toEqual({ id: 'x', title: 'Corte', description: '30 min' })
  })

  it('pages times 9 at a time with a "more" row', () => {
    const times = Array.from({ length: 20 }, (_, i) => `${String(8 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`)
    expect(timePage(times.slice(0, 10), 0)).toEqual({ times: times.slice(0, 10), nextOffset: null })
    expect(timePage(times, 0)).toEqual({ times: times.slice(0, 9), nextOffset: 9 })
    expect(timePage(times, 18)).toEqual({ times: times.slice(18), nextOffset: 0 })
  })

  it('lists only days with free times', () => {
    expect(daysWithTimes({ '2026-10-24': ['10:00', '11:00'], '2026-10-26': ['09:00'] }, ['2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26'])).toEqual([
      { date: '2026-10-24', count: 2 },
      { date: '2026-10-26', count: 1 },
    ])
  })

  it('formats short days and parses field answers', () => {
    expect(shortDay('2026-10-23', 'es')).toBe('vie 23 oct')
    expect(shortDay('2026-10-23', 'en')).toBe('Fri, Oct 23')
    expect(parseFieldAnswer({ key: 'email', type: 'email' }, ' Ana@Mail.com ')).toBe('ana@mail.com')
    expect(parseFieldAnswer({ key: 'email', type: 'email' }, 'ana')).toBeNull()
    expect(parseFieldAnswer({ key: 'party_size', type: 'number' }, 'somos 4')).toBe(4)
    expect(parseFieldAnswer({ key: 'customer_name', type: 'text' }, '  ')).toBeNull()
  })
})
