import { describe, expect, it } from 'vitest'
import {
  TEMPLATE_SUGGESTIONS,
  draftFromSuggestion,
  fillVariables,
  namedFromPositional,
  slugifyName,
  splitVariables,
  toMetaPayload,
  toPositional,
  validateDraft,
  variablesIn,
  type TemplateDraft,
} from './model'
import { parseTemplateStatusUpdates } from '@/lib/channels/parsers/whatsapp'

const base = (over: Partial<TemplateDraft> = {}): TemplateDraft => ({
  name: 'confirmacion_de_pedido',
  category: 'Utility',
  language: 'es',
  header: { type: 'none' },
  body: 'Hola {{nombre_cliente}}, tu pedido {{numero_pedido}} está listo. Gracias {{nombre_cliente}} por tu compra.',
  footer: '',
  buttons: [],
  variables: [
    { key: 'nombre_cliente', label: 'Nombre del cliente', example: 'María', source: 'contact.name' },
    { key: 'numero_pedido', label: 'Número de pedido', example: '#1024', source: 'manual' },
  ],
  ...over,
})

describe('template model', () => {
  it('slugs names the way Meta accepts them', () => {
    expect(slugifyName('Confirmación de Pedido!')).toBe('confirmacion_de_pedido')
    expect(slugifyName('  Año nuevo 2027 ')).toBe('ano_nuevo_2027')
  })

  it('finds, splits and fills named variables', () => {
    const d = base()
    expect(variablesIn(d.body)).toEqual(['nombre_cliente', 'numero_pedido'])
    expect(fillVariables(d.body, { nombre_cliente: 'Ana' })).toContain('Hola Ana, tu pedido {{numero_pedido}}')
    expect(splitVariables('Hola {{x}}!').map((p) => p.variable ?? p.text)).toEqual(['Hola ', 'x', '!'])
  })

  it('converts to positional text and back', () => {
    const p = toPositional(base())
    expect(p.body).toBe('Hola {{1}}, tu pedido {{2}} está listo. Gracias {{1}} por tu compra.')
    expect(p.variables.map((v) => [v.key, v.index])).toEqual([['nombre_cliente', 1], ['numero_pedido', 2]])
    expect(namedFromPositional(p.body, p.variables)).toBe(base().body)
  })

  it('builds the Graph API payload with examples', () => {
    const { payload } = toMetaPayload(
      base({
        header: { type: 'text', text: 'Pedido {{numero_pedido}}' },
        footer: 'Gracias',
        buttons: [
          { type: 'quick_reply', text: 'Ok' },
          { type: 'url', text: 'Ver', value: 'https://x.com/p/{{1}}', example: '1024' },
          { type: 'phone', text: 'Llamar', value: '+51 999 888 777' },
        ],
      }),
    )
    const c = payload.components as Record<string, unknown>[]
    expect(payload).toMatchObject({ name: 'confirmacion_de_pedido', language: 'es', category: 'UTILITY' })
    expect(c[0]).toEqual({ type: 'HEADER', format: 'TEXT', text: 'Pedido {{1}}', example: { header_text: ['#1024'] } })
    expect(c[1]).toEqual({ type: 'BODY', text: 'Hola {{1}}, tu pedido {{2}} está listo. Gracias {{1}} por tu compra.', example: { body_text: [['María', '#1024']] } })
    expect(c[2]).toEqual({ type: 'FOOTER', text: 'Gracias' })
    expect(c[3]).toEqual({
      type: 'BUTTONS',
      buttons: [
        { type: 'QUICK_REPLY', text: 'Ok' },
        { type: 'URL', text: 'Ver', url: 'https://x.com/p/{{1}}', example: ['https://x.com/p/1024'] },
        { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+51999888777' },
      ],
    })
  })

  it('authentication templates use Meta’s fixed components', () => {
    const { payload } = toMetaPayload(base({ category: 'Authentication', codeExpiration: 5 }))
    expect(payload.components).toEqual([
      { type: 'BODY', add_security_recommendation: true },
      { type: 'FOOTER', code_expiration_minutes: 5 },
      { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
    ])
    expect(validateDraft(base({ category: 'Authentication', body: '' }))).toEqual([])
  })

  it('validates Meta’s review rules', () => {
    expect(validateDraft(base())).toEqual([])
    const codes = (d: TemplateDraft) => validateDraft(d).map((i) => i.code)
    expect(codes(base({ name: 'Mal Nombre' }))).toContain('name_format')
    expect(codes(base({ body: '{{nombre_cliente}} hola' }))).toContain('variable_at_edge')
    expect(codes(base({ body: 'Hola {{a}} {{b}} {{c}} ya' }))).toContain('too_many_variables')
    expect(codes(base({ variables: [] }))).toContain('variable_undefined')
    expect(codes(base({ variables: base().variables.map((v) => ({ ...v, example: '' })) }))).toContain('example_required')
    expect(codes(base({ header: { type: 'image' } }))).toContain('media_required')
    expect(codes(base({ footer: 'Hola {{x}}' }))).toContain('footer_no_variables')
    expect(codes(base({ buttons: [{ type: 'url', text: 'Ver', value: 'no-url' }] }))).toContain('button_url')
    expect(codes(base({ buttons: [{ type: 'phone', text: 'Llamar', value: '123' }] }))).toContain('button_phone')
  })

  it('every suggestion produces a valid draft', () => {
    for (const s of TEMPLATE_SUGGESTIONS) {
      for (const locale of ['es', 'en'] as const) {
        expect(validateDraft(draftFromSuggestion(s, locale, locale)), `${s.id} ${locale}`).toEqual([])
      }
    }
  })

  it('parses template review webhooks', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba',
          changes: [
            { field: 'message_template_status_update', value: { event: 'REJECTED', message_template_id: 123, message_template_name: 'promo', message_template_language: 'es', reason: 'INCORRECT_CATEGORY' } },
            { field: 'messages', value: {} },
          ],
        },
      ],
    }
    expect(parseTemplateStatusUpdates(body as never)).toEqual([{ metaId: '123', event: 'REJECTED', name: 'promo', language: 'es', reason: 'INCORRECT_CATEGORY' }])
  })
})
