import { describe, expect, it } from 'vitest'
import { cardAttachment, cardIssues, normalizeMessengerSettings, parseCard, parseOptins } from './model'

describe('card', () => {
  const ok = { title: 'Oferta', subtitle: '2x1', image_url: 'https://x.test/a.jpg', button_text: 'Ver', button_url: 'https://s.test' }
  it('validates', () => {
    expect(cardIssues(parseCard(ok)!)).toEqual([])
    expect(cardIssues(parseCard({ ...ok, title: '', image_url: 'http://x', button_text: 'x'.repeat(21), button_url: 'nope' })!)).toEqual(['title', 'image', 'button_text', 'button_url'])
  })
  it('builds the generic template', () => {
    const a = cardAttachment(ok)
    expect(a.attachment.payload.template_type).toBe('generic')
    expect(a.attachment.payload.elements[0]).toMatchObject({ title: 'Oferta', subtitle: '2x1', image_url: ok.image_url, buttons: [{ type: 'web_url', url: ok.button_url, title: 'Ver' }] })
  })
})

describe('settings', () => {
  it('defaults by language', () => {
    expect(normalizeMessengerSettings(null, 'es')).toEqual({ auto_invite: false, invite_title: 'Recibe nuestras ofertas y novedades', invite_image_url: null })
    expect(normalizeMessengerSettings({ auto_invite: true, invite_title: ' Hola ', invite_image_url: 'http://x' }, 'en')).toEqual({ auto_invite: true, invite_title: 'Hola', invite_image_url: null })
  })
})

describe('parseOptins', () => {
  it('reads opt-ins and stops from the page webhook', () => {
    const body = {
      object: 'page',
      entry: [
        {
          id: 'PAGE',
          messaging: [
            { sender: { id: 'U1' }, recipient: { id: 'PAGE' }, timestamp: 1, optin: { type: 'notification_messages', notification_messages_token: 'T1', notification_messages_status: 'RESUME_NOTIFICATIONS', token_expiry_timestamp: 1900000000 } },
            { sender: { id: 'U2' }, recipient: { id: 'PAGE' }, timestamp: 2, optin: { type: 'notification_messages', notification_messages_status: 'STOP_NOTIFICATIONS' } },
            { sender: { id: 'U3' }, recipient: { id: 'PAGE' }, timestamp: 3, message: { mid: 'm', text: 'hola' } },
          ],
        },
      ],
    }
    const out = parseOptins(body)
    expect(out).toHaveLength(2)
    expect(out[0]).toMatchObject({ pageId: 'PAGE', psid: 'U1', token: 'T1', status: 'subscribed' })
    expect(out[0].expiresAt?.toISOString()).toBe(new Date(1900000000 * 1000).toISOString())
    expect(out[1]).toMatchObject({ psid: 'U2', status: 'stopped', token: null })
    expect(parseOptins({ object: 'instagram', entry: body.entry })).toEqual([])
  })
})
