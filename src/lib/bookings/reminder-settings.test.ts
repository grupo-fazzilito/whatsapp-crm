import { describe, expect, it } from 'vitest'
import { fillReminderText, parseReminderReply, parseReminderSettings, reminderReplyId, reminderSettings } from './reminder-settings'

describe('reminder settings', () => {
  it('reads what is stored, ignoring junk', () => {
    expect(reminderSettings(null)).toEqual({ off: [], texts: {} })
    expect(reminderSettings({ booking_reminders: { off: ['4h', 'nope', '4h'], texts: { '24h': '  Hola {nombre}  ', '2h': '', x: 'y' } } })).toEqual({
      off: ['4h'],
      texts: { '24h': 'Hola {nombre}' },
    })
  })

  it('rejects texts that are too long', () => {
    expect(() => parseReminderSettings({ texts: { '24h': 'x'.repeat(901) } })).toThrow()
    expect(() => parseReminderSettings('nope')).toThrow()
  })

  it('fills placeholders and tidies empty ones', () => {
    const values = { nombre: 'Ana', cita: 'turno', servicio: '', profesional: 'Mario', fecha: 'sábado 24 de octubre', hora: '10:00', negocio: 'Barbería' }
    expect(fillReminderText('Hola {nombre}, tu {cita} es el {fecha} a las {hora} con {profesional} {servicio}. {otro}', values)).toBe(
      'Hola Ana, tu turno es el sábado 24 de octubre a las 10:00 con Mario. {otro}',
    )
  })

  it('round-trips button ids', () => {
    const id = '11111111-2222-3333-4444-555555555555'
    expect(parseReminderReply(reminderReplyId('confirm', id))).toEqual({ action: 'confirm', bookingId: id })
    expect(parseReminderReply('rem:delete:' + id)).toBeNull()
    expect(parseReminderReply('bk:day:2026-10-24')).toBeNull()
  })
})
