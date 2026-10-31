import { describe, expect, it } from 'vitest'
import { fillReply, matchesKeywords, parseCommentWebhook, parseRuleInput, pickPublicReply, pickRule } from './model'

describe('webhook parsing', () => {
  it('reads Instagram comments and leaves out the account’s own replies under a comment', () => {
    const events = parseCommentWebhook({
      object: 'instagram',
      entry: [{
        id: 'IG1',
        changes: [
          { field: 'comments', value: { id: 'C1', text: 'Precio?', from: { id: 'U1', username: 'ana.pe' }, media: { id: 'M1', media_product_type: 'REELS' } } },
          { field: 'comments', value: { id: 'C2', text: 'Te escribimos', from: { id: 'IG1', username: 'tienda' }, media: { id: 'M1' }, parent_id: 'C1' } },
          { field: 'comments', value: { id: 'C3', text: 'precio', from: { id: 'IG1', username: 'tienda' }, media: { id: 'M1' } } },
          { field: 'mentions', value: { media_id: 'X' } },
        ],
      }],
    })
    expect(events).toEqual([
      { channelType: 'instagram', channelExternalId: 'IG1', commentId: 'C1', postId: 'M1', parentId: null, from: { id: 'U1', name: 'ana.pe' }, text: 'Precio?' },
      // The account commenting on its own post is answered too.
      { channelType: 'instagram', channelExternalId: 'IG1', commentId: 'C3', postId: 'M1', parentId: null, from: { id: 'IG1', name: 'tienda' }, text: 'precio' },
    ])
  })

  it('reads new Facebook comments only (not edits, likes or the page’s replies under a comment)', () => {
    const events = parseCommentWebhook({
      object: 'page',
      entry: [{
        id: 'P1',
        changes: [
          { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'P1_C1', post_id: 'P1_POST', parent_id: 'P1_POST', from: { id: 'U2', name: 'Luis Rojas' }, message: 'info' } },
          { field: 'feed', value: { item: 'comment', verb: 'edited', comment_id: 'P1_C2', post_id: 'P1_POST', from: { id: 'U2' }, message: 'info' } },
          { field: 'feed', value: { item: 'reaction', verb: 'add', post_id: 'P1_POST', from: { id: 'U3' } } },
          { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'P1_C3', post_id: 'P1_POST', parent_id: 'P1_C1', from: { id: 'P1', name: 'Tienda' }, message: 'gracias' } },
          { field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'P1_C4', post_id: 'P1_POST', parent_id: 'P1_POST', from: { id: 'P1', name: 'Tienda' }, message: 'precio' } },
        ],
      }],
    })
    expect(events).toEqual([
      { channelType: 'messenger', channelExternalId: 'P1', commentId: 'P1_C1', postId: 'P1_POST', parentId: null, from: { id: 'U2', name: 'Luis Rojas' }, text: 'info' },
      { channelType: 'messenger', channelExternalId: 'P1', commentId: 'P1_C4', postId: 'P1_POST', parentId: null, from: { id: 'P1', name: 'Tienda' }, text: 'precio' },
    ])
  })

  it('ignores other objects and message-only payloads', () => {
    expect(parseCommentWebhook({ object: 'whatsapp_business_account', entry: [{ id: 'W', changes: [{ field: 'comments', value: { id: 'x' } }] }] })).toEqual([])
    expect(parseCommentWebhook({ object: 'page', entry: [{ id: 'P1' }] })).toEqual([])
  })
})

describe('keywords', () => {
  it('matches whole words, ignoring case, accents and punctuation', () => {
    expect(matchesKeywords('¿Cuál es el PRECIO?', ['precio'])).toBe(true)
    expect(matchesKeywords('Más información', ['informacion'])).toBe(true)
    expect(matchesKeywords('es informal', ['info'])).toBe(false)
    expect(matchesKeywords('quiero el link de compra', ['link de compra'])).toBe(true)
    expect(matchesKeywords('cualquier cosa', [])).toBe(true)
    expect(matchesKeywords('hola', ['precio', 'info'])).toBe(false)
  })
})

describe('rules', () => {
  const base = { enabled: true, channel_id: null, post_id: null, keywords: ['precio'], position: 0 }
  const rules = [
    { ...base, id: 'general' },
    { ...base, id: 'reel', post_id: 'M1', position: 5 },
    { ...base, id: 'other-account', channel_id: 'CH2', keywords: [], position: 1 },
    { ...base, id: 'off', enabled: false, keywords: [], position: -1 },
  ]
  it('prefers a rule for the post, then the lowest position', () => {
    expect(pickRule(rules, { channelId: 'CH1', postId: 'M1', text: 'precio?' })?.id).toBe('reel')
    expect(pickRule(rules, { channelId: 'CH1', postId: 'M9', text: 'precio?' })?.id).toBe('general')
    expect(pickRule(rules, { channelId: 'CH1', postId: 'M9', text: 'hola' })).toBeNull()
    expect(pickRule(rules, { channelId: 'CH2', postId: 'M9', text: 'hola' })?.id).toBe('other-account')
  })

  it('fills the first name and picks one of the public replies', () => {
    expect(fillReply('Hola {nombre}, te escribimos 📩', 'Ana Pérez')).toBe('Hola Ana, te escribimos 📩')
    expect(fillReply('Hola {nombre}, te escribimos', null)).toBe('Hola, te escribimos')
    expect(fillReply('Hi {name}!', '@ana.pe')).toBe('Hi ana.pe!')
    expect(pickPublicReply(['a', ' ', 'b'], () => 0.99)).toBe('b')
    expect(pickPublicReply([' '])).toBeNull()
  })

  it('validates the editor input', () => {
    expect(parseRuleInput({ name: '', public_replies: ['x'] })).toEqual({ ok: false, error: 'name' })
    expect(parseRuleInput({ name: 'Precio', keywords: ['precio'] })).toEqual({ ok: false, error: 'reply' })
    const ok = parseRuleInput({ name: ' Precio ', keywords: ['precio', 'precio', ' '], public_replies: ['Te escribimos'], private_message: 'Cuesta S/ 50', channel_id: '' })
    expect(ok).toEqual({ ok: true, rule: { name: 'Precio', channel_id: null, post_id: null, post_label: null, keywords: ['precio'], public_replies: ['Te escribimos'], private_message: 'Cuesta S/ 50', enabled: true } })
  })
})
