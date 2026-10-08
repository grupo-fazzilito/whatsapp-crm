import { describe, expect, it } from 'vitest'
import {
  formatToday,
  isValidShortcut,
  matchQuickReplies,
  normalizeAttachments,
  normalizeShortcut,
  parseQuickReplyInput,
  renderQuickReply,
  replaceToken,
  slashQuery,
} from './quick-replies'
import { extractMentions, filterMentionCandidates, mentionQuery, splitMentions } from './mentions'
import { parseInboxSettings, pickRoundRobin } from './assignment'
import { DEFAULT_FILTERS, filterAndSort, matchesFilters, sortConversations, type FilterableConversation } from './filters'
import { isPriority, priorityOf, priorityRank } from './priority'
import { notificationText, snippet } from './texts'

const WS = '11111111-1111-4111-8111-111111111111'

describe('quick replies', () => {
  it('replaces variables in any case', () => {
    expect(
      renderQuickReply('Hola {nombre}, soy {Agente} de {NEGOCIO}. Hoy es {fecha}.', {
        nombre: 'Ana',
        agente: 'Luis',
        negocio: 'Pollería Rico',
        fecha: '8 de octubre de 2026',
      }),
    ).toBe('Hola Ana, soy Luis de Pollería Rico. Hoy es 8 de octubre de 2026.')
  })

  it('drops missing variables and tidies the spacing', () => {
    expect(renderQuickReply('¡Hola {nombre}! ¿En qué te ayudo?', {})).toBe('¡Hola! ¿En qué te ayudo?')
    expect(renderQuickReply('Hola {nombre}, gracias', { nombre: '  ' })).toBe('Hola, gracias')
  })

  it('keeps unknown placeholders', () => {
    expect(renderQuickReply('Código {codigo} para {nombre}', { nombre: 'Ana' })).toBe('Código {codigo} para Ana')
  })

  it('formats today in the workspace time zone', () => {
    // 03:00 UTC on Oct 9 is still Oct 8 in Lima.
    const now = new Date('2026-10-09T03:00:00Z')
    expect(formatToday('America/Lima', 'es', now)).toBe('8 de octubre de 2026')
    expect(formatToday('America/Lima', 'en', now)).toBe('October 8, 2026')
    expect(formatToday('Not/AZone', 'es', now)).toMatch(/2026/)
  })

  it('normalizes and validates shortcuts', () => {
    expect(normalizeShortcut('/Horario Atención')).toBe('horario-atencion')
    expect(normalizeShortcut('  --pago!! ')).toBe('pago')
    expect(isValidShortcut('pago_1')).toBe(true)
    expect(isValidShortcut('-x')).toBe(false)
    expect(isValidShortcut('')).toBe(false)
    expect(isValidShortcut('a'.repeat(33))).toBe(false)
  })

  it('validates attachments to the workspace folder', () => {
    expect(
      normalizeAttachments(
        [
          { path: `${WS}/quick-replies/a.pdf`, type: 'document', name: 'Carta.pdf' },
          { path: `other/quick-replies/b.png`, type: 'image', name: 'x' },
          { path: `${WS}/../b.png`, type: 'image', name: 'x' },
          { url: 'http://insecure/x.png', type: 'image', name: 'x' },
          { url: 'https://cdn.example.com/x.png', type: 'image' },
          { path: `${WS}/q/c.exe`, type: 'binary', name: 'x' },
        ],
        WS,
      ),
    ).toEqual([
      { path: `${WS}/quick-replies/a.pdf`, type: 'document', name: 'Carta.pdf' },
      { url: 'https://cdn.example.com/x.png', type: 'image', name: 'image' },
    ])
    expect(normalizeAttachments(null)).toEqual([])
    expect(normalizeAttachments('nope')).toBeNull()
  })

  it('parses create and update bodies', () => {
    expect(parseQuickReplyInput({ shortcut: '/Saludo', title: ' Hola ', body: 'Hola {nombre}' }, WS, false)).toEqual({
      ok: true,
      value: { shortcut: 'saludo', title: 'Hola', body: 'Hola {nombre}', attachments: [] },
    })
    expect(parseQuickReplyInput({ shortcut: '!!', title: 'x', body: 'y' }, WS, false)).toEqual({ ok: false, error: 'invalid_shortcut' })
    expect(parseQuickReplyInput({ shortcut: 'a', title: '', body: 'y' }, WS, false)).toEqual({ ok: false, error: 'title_required' })
    expect(parseQuickReplyInput({ shortcut: 'a', title: 'x', body: '' }, WS, false)).toEqual({ ok: false, error: 'empty_reply' })
    expect(parseQuickReplyInput({ title: 'Nuevo', is_shared: true }, WS, true)).toEqual({ ok: true, value: { title: 'Nuevo', is_shared: true } })
  })

  it('ranks matches: prefix, then contains, then body', () => {
    const list = [
      { shortcut: 'horario', title: 'Horario', body: 'Abrimos a las 9' },
      { shortcut: 'pago', title: 'Medios de pago', body: 'Yape o Plin' },
      { shortcut: 'yape', title: 'Yape', body: 'Número' },
      { shortcut: 'envio', title: 'Delivery', body: 'Pago contra entrega con yape' },
    ]
    expect(matchQuickReplies(list, 'ya').map((q) => q.shortcut)).toEqual(['yape', 'envio', 'pago'])
    expect(matchQuickReplies(list, '').map((q) => q.shortcut)).toEqual(['envio', 'horario', 'pago', 'yape'])
    expect(matchQuickReplies(list, 'zzz')).toEqual([])
  })

  it('detects the "/query" token at the caret', () => {
    expect(slashQuery('/sal', 4)).toEqual({ start: 0, query: 'sal' })
    expect(slashQuery('Hola /pa', 8)).toEqual({ start: 5, query: 'pa' })
    expect(slashQuery('http://x', 8)).toBeNull()
    expect(slashQuery('a/b', 3)).toBeNull()
    expect(slashQuery('/sal y más', 10)).toBeNull()
  })

  it('replaces the token and moves the caret', () => {
    expect(replaceToken('Hola /sa!', 5, 8, 'Buenas')).toEqual({ text: 'Hola Buenas!', caret: 11 })
  })
})

describe('mentions', () => {
  const people = [
    { userId: 'u1', name: 'Ana Pérez' },
    { userId: 'u2', name: 'Luis Ángel Ruiz' },
    { userId: 'u3', name: 'Ana' },
  ]

  it('detects the "@query" token at the caret', () => {
    expect(mentionQuery('Hola @lu', 8)).toEqual({ start: 5, query: 'lu' })
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' })
    expect(mentionQuery('correo@x', 8)).toBeNull()
  })

  it('filters candidates by any word, accent-insensitive', () => {
    expect(filterMentionCandidates(people, 'ang').map((p) => p.userId)).toEqual(['u2'])
    expect(filterMentionCandidates(people, 'ana').map((p) => p.userId)).toEqual(['u1', 'u3'])
    expect(filterMentionCandidates(people, 'rez').map((p) => p.userId)).toEqual(['u1'])
  })

  it('extracts mentioned users by full name with word boundaries', () => {
    expect(extractMentions('@Ana Pérez revisa esto con @Luis Ángel Ruiz', people)).toEqual(['u1', 'u2'])
    // "@Ana" alone matches the "Ana" member, not "Ana Pérez".
    expect(extractMentions('Gracias @Ana!', people)).toEqual(['u3'])
    expect(extractMentions('@Anabel hola', people)).toEqual([])
    expect(extractMentions('ana@correo.com', people)).toEqual([])
  })

  it('splits text for highlighting, longest names first', () => {
    expect(splitMentions('Ojo @Ana Pérez y @Ana.', ['Ana', 'Ana Pérez'])).toEqual([
      { text: 'Ojo ', mention: false },
      { text: '@Ana Pérez', mention: true },
      { text: ' y ', mention: false },
      { text: '@Ana', mention: true },
      { text: '.', mention: false },
    ])
    expect(splitMentions('sin menciones', ['Ana'])).toEqual([{ text: 'sin menciones', mention: false }])
    expect(splitMentions('x@Ana', ['Ana'])).toEqual([{ text: 'x@Ana', mention: false }])
  })
})

describe('round robin', () => {
  it('picks the available member assigned least recently (never first)', () => {
    const c = [
      { user_id: 'b', available: true, last_assigned_at: '2026-10-08T10:00:00Z' },
      { user_id: 'a', available: true, last_assigned_at: '2026-10-08T09:00:00Z' },
      { user_id: 'c', available: false, last_assigned_at: null },
      { user_id: 'd', available: true, last_assigned_at: null },
    ]
    expect(pickRoundRobin(c)).toBe('d')
    expect(pickRoundRobin(c, ['d'])).toBe('a')
    expect(pickRoundRobin(c.filter((x) => !x.available))).toBeNull()
    expect(pickRoundRobin([])).toBeNull()
  })

  it('breaks ties by user id', () => {
    expect(
      pickRoundRobin([
        { user_id: 'z', available: true, last_assigned_at: null },
        { user_id: 'm', available: true, last_assigned_at: null },
      ]),
    ).toBe('m')
  })

  it('reads settings.inbox with defaults', () => {
    expect(parseInboxSettings(null)).toEqual({ auto_assign: 'off', default_team_id: null })
    expect(parseInboxSettings({ inbox: { auto_assign: 'round_robin', default_team_id: WS } })).toEqual({
      auto_assign: 'round_robin',
      default_team_id: WS,
    })
    expect(parseInboxSettings({ inbox: { auto_assign: 'random', default_team_id: 'x' } })).toEqual({
      auto_assign: 'off',
      default_team_id: null,
    })
  })
})

describe('priority', () => {
  it('validates and ranks', () => {
    expect(isPriority('urgent')).toBe(true)
    expect(isPriority('critical')).toBe(false)
    expect(priorityOf(undefined)).toBe('normal')
    expect(priorityRank('urgent')).toBeGreaterThan(priorityRank('high'))
    expect(priorityRank('low')).toBeLessThan(priorityRank(null))
  })
})

describe('conversation filters', () => {
  const conv = (o: Partial<FilterableConversation> & { id: string }) =>
    ({ status: 'open', last_message_at: '2026-10-08T10:00:00Z', ...o }) as FilterableConversation & { id: string }
  const list = [
    conv({ id: '1', assigned_agent_id: 'me', priority: 'urgent', conversation_tags: [{ tag_id: 't1' }], contact: { name: 'Ana' } }),
    conv({ id: '2', status: 'pending', priority: 'low', contact: { name: 'Beto', contact_tags: [{ tag_id: 't1' }] } }),
    conv({ id: '3', status: 'closed', assigned_agent_id: 'me', contact: { name: 'Carla' } }),
    conv({ id: '4', assigned_agent_id: 'other', channel_id: 'ch2', last_message_text: 'quiero pollo', priority: 'high' }),
  ]
  const ids = (f: Partial<typeof DEFAULT_FILTERS>) =>
    list.filter((c) => matchesFilters(c, { ...DEFAULT_FILTERS, currentUserId: 'me', ...f })).map((c) => c.id)

  it('views hide resolved conversations except "Resueltas"', () => {
    expect(ids({ view: 'all' })).toEqual(['1', '2', '4'])
    expect(ids({ view: 'mine' })).toEqual(['1'])
    expect(ids({ view: 'unassigned' })).toEqual(['2'])
    expect(ids({ view: 'resolved' })).toEqual(['3'])
  })

  it('filters by status, channel, priority and search', () => {
    expect(ids({ status: 'pending' })).toEqual(['2'])
    expect(ids({ channelId: 'ch2' })).toEqual(['4'])
    expect(ids({ priorities: ['urgent', 'high'] })).toEqual(['1', '4'])
    expect(ids({ search: 'POLLO' })).toEqual(['4'])
    expect(ids({ search: 'carla', view: 'resolved' })).toEqual(['3'])
  })

  it('filters by tags, optionally including the contact tags', () => {
    expect(ids({ tagIds: ['t1'] })).toEqual(['1'])
    expect(ids({ tagIds: ['t1'], includeContactTags: true })).toEqual(['1', '2'])
    expect(ids({ tagIds: ['t9'] })).toEqual([])
  })

  it('sorts by priority (urgent first) and by waiting time', () => {
    const rows = [
      conv({ id: 'a', priority: 'low', last_message_at: '2026-10-08T12:00:00Z' }),
      conv({ id: 'b', priority: 'urgent', last_message_at: '2026-10-08T08:00:00Z' }),
      conv({ id: 'c', last_message_at: '2026-10-08T11:00:00Z' }),
      conv({ id: 'd', priority: 'urgent', last_message_at: '2026-10-08T09:00:00Z' }),
    ]
    expect(sortConversations(rows, 'recent').map((c) => c.id)).toEqual(['a', 'c', 'd', 'b'])
    expect(sortConversations(rows, 'priority').map((c) => c.id)).toEqual(['d', 'b', 'c', 'a'])

    const waiting = [
      // We answered last: not waiting.
      conv({ id: 'w1', last_customer_message_at: '2026-10-08T07:00:00Z', last_message_at: '2026-10-08T12:00:00Z' }),
      conv({ id: 'w2', last_customer_message_at: '2026-10-08T09:00:00Z', last_message_at: '2026-10-08T09:00:00Z' }),
      conv({ id: 'w3', last_customer_message_at: '2026-10-08T08:00:00Z', last_message_at: '2026-10-08T08:00:00Z' }),
      conv({ id: 'w4', last_message_at: '2026-10-08T13:00:00Z' }),
    ]
    expect(sortConversations(waiting, 'waiting').map((c) => c.id)).toEqual(['w3', 'w2', 'w4', 'w1'])
  })

  it('filterAndSort combines both', () => {
    expect(filterAndSort(list, { ...DEFAULT_FILTERS, currentUserId: 'me' }, 'priority').map((c) => (c as { id: string }).id)).toEqual([
      '1',
      '4',
      '2',
    ])
  })
})

describe('notification texts', () => {
  it('uses the workspace language', () => {
    expect(notificationText('es', 'mention', { actor: 'Ana' })).toBe('Ana te mencionó en una nota')
    expect(notificationText('en', 'teamTransferred', { actor: 'Ana', team: 'Ventas' })).toBe(
      'Ana transferred a conversation to the Ventas team',
    )
    expect(notificationText(null, 'autoAssigned')).toBe('Se te asignó una conversación nueva')
  })

  it('makes one-line snippets', () => {
    expect(snippet('  hola\n\nmundo  ')).toBe('hola mundo')
    expect(snippet('x'.repeat(10), 5)).toBe('xxxx…')
  })
})
