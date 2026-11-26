import { describe, expect, it } from 'vitest'
import { backupFileName, backupHeader, backupRow, localDate, type BackupMessage } from './messages-format'

const base: BackupMessage = {
  id: 'm1',
  created_at: new Date('2026-11-26T19:03:22Z'),
  conversation_id: 'c1',
  sender_type: 'customer',
  content_type: 'text',
  content_text: 'Hola',
  transcript: null,
  media_url: null,
  template_name: null,
  status: 'delivered',
  is_internal: false,
  channel_type: 'whatsapp',
  channel_name: 'Tienda',
  contact_name: 'Ana',
  contact_phone: '+51987654321',
  contact_email: null,
  agent_name: 'Luis',
  ai_name: 'Sofía',
}
const o = { lang: 'es' as const, timeZone: 'America/Lima', origin: 'https://app.whasalia.com' }

describe('conversations backup rows', () => {
  it('dates in the business time zone (Lima is UTC-5); a bad zone falls back to UTC', () => {
    expect(localDate(base.created_at, 'America/Lima')).toBe('2026-11-26 14:03:22')
    expect(localDate(base.created_at, 'Nope/Zone')).toBe('2026-11-26 19:03:22')
  })

  it('one row per message, with who wrote it by name', () => {
    expect(backupHeader('es')).toHaveLength(backupRow(base, o).length)
    expect(backupRow(base, o)).toEqual(['2026-11-26 14:03:22', 'c1', 'whatsapp', 'Tienda', 'Ana', '+51987654321', null, 'Cliente', 'Ana', 'text', 'Hola', null, null, 'delivered', 'No'])
    expect(backupRow({ ...base, sender_type: 'agent', is_internal: true }, o).slice(7, 9)).toEqual(['Equipo', 'Luis'])
    expect(backupRow({ ...base, sender_type: 'agent', is_internal: true }, o).at(-1)).toBe('Sí')
    expect(backupRow({ ...base, sender_type: 'bot' }, { ...o, lang: 'en' }).slice(7, 9)).toEqual(['AI / automation', 'Sofía'])
  })

  it('a voice note shows its transcript; app media gets the full link', () => {
    const row = backupRow({ ...base, content_type: 'audio', content_text: null, transcript: 'quiero precios', media_url: '/api/media/ch/M1' }, o)
    expect(row[10]).toBe('quiero precios')
    expect(row[11]).toBe('https://app.whasalia.com/api/media/ch/M1')
  })

  it('file names', () => {
    expect(backupFileName('es', null, null)).toBe('respaldo-conversaciones.csv')
    expect(backupFileName('es', '2026-11-01', null)).toBe('respaldo-conversaciones-2026-11-01_hoy.csv')
    expect(backupFileName('en', '2026-11-01', '2026-11-26')).toBe('conversations-backup-2026-11-01_2026-11-26.csv')
  })
})
