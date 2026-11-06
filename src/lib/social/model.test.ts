import { describe, expect, it } from 'vitest'
import { captionFor, cleanPhone, normalizeSocial, overallStatus, parsePostInput, postIssues, upcomingSlots } from './model'

const img = { url: 'https://x.test/a.jpg', type: 'image' as const }
const vid = { url: 'https://x.test/a.mp4', type: 'video' as const }

describe('normalizeSocial', () => {
  it('falls back to safe defaults', () => {
    const s = normalizeSocial(null)
    expect(s.approval).toBe('required')
    expect(s.auto_new_product).toBe(false)
    expect(s.calendar.enabled).toBe(false)
  })
  it('keeps valid values and drops invalid ones', () => {
    const s = normalizeSocial({
      approval: 'auto',
      auto_targets: ['instagram', 'tiktok', 'instagram'],
      calendar: { enabled: true, slots: [{ day: 1, time: '19:00' }, { day: 9, time: '10:00' }, { day: 1, time: '19:00' }, { day: 3, time: '25:00' }], format: 'story' },
      status_phones: ['+51 987 654 321', '123', '51987654321'],
      status_channel_id: 'nope',
      caption_instructions: '  tutea  ',
    })
    expect(s.approval).toBe('auto')
    expect(s.auto_targets).toEqual(['instagram'])
    expect(s.calendar.slots).toEqual([{ day: 1, time: '19:00' }])
    expect(s.calendar.format).toBe('story')
    expect(s.status_phones).toEqual(['51987654321'])
    expect(s.status_channel_id).toBeNull()
    expect(s.caption_instructions).toBe('tutea')
  })
})

describe('cleanPhone', () => {
  it('keeps 8–15 digits', () => {
    expect(cleanPhone('+1 (555) 123-4567')).toBe('15551234567')
    expect(cleanPhone('12')).toBeNull()
  })
})

describe('parsePostInput / postIssues', () => {
  const base = { format: 'post', caption: 'Hola', media: [img], targets: ['facebook'] }
  it('parses a valid post', () => {
    const p = parsePostInput({ ...base, scheduled_at: '2030-01-01T10:00:00Z' })!
    expect(p.scheduled_at).toBe('2030-01-01T10:00:00.000Z')
    expect(postIssues(p, new Date('2029-12-31T00:00:00Z'))).toEqual([])
  })
  it('rejects bad shapes', () => {
    expect(parsePostInput({ ...base, targets: ['tiktok'] })).toBeNull()
    expect(parsePostInput({ ...base, media: [{ url: 'javascript:x', type: 'image' }] })).toBeNull()
    expect(parsePostInput({ ...base, link_url: 'notaurl' })).toBeNull()
  })
  it('checks format rules', () => {
    expect(postIssues({ ...parsePostInput({ ...base, format: 'reel' })! })).toContain('video_required')
    expect(postIssues({ ...parsePostInput({ ...base, format: 'story', media: [img, img] })! })).toContain('one_media')
    expect(postIssues({ ...parsePostInput({ ...base, format: 'reel', media: [vid] })! })).toEqual([])
    expect(postIssues({ ...parsePostInput({ ...base, targets: [], media: [] })! })).toEqual(expect.arrayContaining(['targets', 'media_required']))
  })
  it('flags past dates only when scheduling', () => {
    const p = parsePostInput({ ...base, scheduled_at: '2020-01-01T00:00:00Z' })!
    expect(postIssues(p)).toContain('schedule_past')
    expect(postIssues({ ...p, draft: true })).not.toContain('schedule_past')
  })
})

describe('captionFor', () => {
  it('adds the link on Facebook only', () => {
    expect(captionFor('facebook', 'Hola', 'https://s.test/p')).toBe('Hola\n\nhttps://s.test/p')
    expect(captionFor('instagram', 'Hola', 'https://s.test/p')).toBe('Hola')
    expect(captionFor('facebook', 'Ver https://s.test/p', 'https://s.test/p')).toBe('Ver https://s.test/p')
  })
})

describe('overallStatus', () => {
  it('combines the destinations', () => {
    expect(overallStatus(['facebook', 'instagram'], { facebook: { status: 'published' }, instagram: { status: 'published' } })).toBe('published')
    expect(overallStatus(['facebook', 'instagram'], { facebook: { status: 'published' }, instagram: { status: 'failed' } })).toBe('partial')
    expect(overallStatus(['facebook'], { facebook: { status: 'failed' } })).toBe('failed')
    expect(overallStatus(['instagram', 'whatsapp_status'], { instagram: { status: 'processing' }, whatsapp_status: { status: 'sent' } })).toBe('publishing')
  })
})

describe('upcomingSlots', () => {
  it('finds the slots of the next 24 h in the business time zone', () => {
    // Monday 2026-11-09 10:00 in Lima (UTC-5) = 15:00 UTC.
    const now = new Date('2026-11-09T15:00:00Z')
    const slots = upcomingSlots([{ day: 1, time: '19:00' }, { day: 2, time: '09:00' }, { day: 1, time: '08:00' }, { day: 3, time: '19:00' }], 'America/Lima', now, 24)
    expect(slots.map((s) => s.key)).toEqual(['2026-11-09T19:00', '2026-11-10T09:00'])
    expect(slots[0].at.toISOString()).toBe('2026-11-10T00:00:00.000Z')
  })
})
