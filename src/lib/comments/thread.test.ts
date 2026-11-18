import { describe, expect, it } from 'vitest'
import { fromFacebook, fromInstagram, fromTiktok, replyLimit } from './thread'

describe('comment viewer threads', () => {
  it('Facebook: the Page’s replies mark a comment as answered and its own comments can’t be hidden', () => {
    const rows = fromFacebook(
      [
        { id: 'c1', message: '¿Precio?', created_time: '2026-11-18T10:00:00+0000', from: { id: 'u1', name: 'Ana' }, can_hide: true, comments: { data: [{ id: 'r1', message: 'S/ 50', from: { id: 'P1', name: 'Clínica' } }] } },
        { id: 'c2', message: 'Hola', from: { id: 'u2', name: 'Luis' }, is_hidden: true, can_hide: true },
        { id: 'c3', message: 'Promo', from: { id: 'P1' }, can_hide: true },
      ],
      'P1',
      'Clínica',
    )
    expect(rows.map((r) => [r.id, r.author, r.replied, r.hidden, r.canHide, r.fromAccount])).toEqual([
      ['c1', 'Ana', true, false, true, false],
      ['c2', 'Luis', false, true, true, false],
      ['c3', 'Clínica', false, false, false, true],
    ])
    expect(rows[0].replies[0]).toMatchObject({ author: 'Clínica', fromAccount: true })
  })

  it('Instagram: replies from the business username count as answered', () => {
    const [c] = fromInstagram(
      [{ id: 'i1', text: 'info', username: 'ana.pe', hidden: false, replies: { data: [{ id: 'i2', text: 'DM!', username: 'clinica', from: { id: 'IG1' } }] } }],
      'IG1',
      'clinica',
    )
    expect(c).toMatchObject({ author: 'ana.pe', replied: true, canHide: true, fromAccount: false })
  })

  it('TikTok: owner replies, hidden status, seconds to ISO, and no stray replies at top level', () => {
    const rows = fromTiktok([
      { comment_id: '7300000000000000001', text: 'price?', create_time: 1763460000, display_name: 'Ana', status: 'HIDDEN', reply_list: [{ comment_id: '7300000000000000002', text: 'S/ 50', owner: true, username: 'clinic' }] },
      { comment_id: '7300000000000000003', text: 'reply', parent_comment_id: '7300000000000000001' },
      { comment_id: '7300000000000000004', text: 'wow', username: 'luis', status: 'PUBLIC' },
    ])
    expect(rows.map((r) => [r.id, r.author, r.replied, r.hidden])).toEqual([
      ['7300000000000000001', 'Ana', true, true],
      ['7300000000000000004', 'luis', false, false],
    ])
    expect(rows[0].createdAt).toBe(new Date(1763460000 * 1000).toISOString())
    expect(replyLimit('tiktok')).toBe(1200)
  })
})
