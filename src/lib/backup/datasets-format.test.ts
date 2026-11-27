import { describe, expect, it } from 'vitest'
import { applyMapping, guessMapping, normalizeRow } from '@/lib/catalog/import'
import {
  automationRow,
  automationsHeader,
  automationsJson,
  buttonsText,
  contactRow,
  contactsHeader,
  csvLine,
  optionsText,
  parseDatasets,
  productRow,
  productsHeader,
  readmeText,
  templateRow,
  templatesHeader,
  variantRow,
  variantsHeader,
  zipFileName,
  type BackupAutomation,
  type BackupProduct,
} from './datasets-format'

const tz = 'America/Lima'

describe('parseDatasets', () => {
  it('all when not given, canonical order, rejects unknown or empty', () => {
    expect(parseDatasets(null)).toEqual(['conversations', 'contacts', 'products', 'automations', 'templates'])
    expect(parseDatasets('templates,contacts')).toEqual(['contacts', 'templates'])
    expect(parseDatasets('contacts,contacts')).toEqual(['contacts'])
    expect(parseDatasets('')).toBeNull()
    expect(parseDatasets('contacts,users')).toBeNull()
  })
})

describe('contacts CSV', () => {
  const fields = [
    { id: 'f1', field_name: 'Cumpleaños' },
    { id: 'f2', field_name: 'DNI' },
  ]
  it('a column per custom field, tags joined, local date', () => {
    expect(contactsHeader('es', fields)).toEqual(['Nombre', 'Teléfono', 'Correo', 'Empresa', 'Etiquetas', 'Canales', 'Cumpleaños', 'DNI', 'Creado', 'ID'])
    expect(contactsHeader('en', [])[0]).toBe('Name')
    const row = contactRow(
      {
        id: 'c1',
        name: 'Ana',
        phone: '+51911111111',
        email: 'ana@x.pe',
        company: null,
        created_at: '2026-11-01T15:00:00.000Z',
        tags: ['VIP', 'Lima'],
        channels: ['whatsapp', 'instagram', 'whatsapp'],
        custom: { f2: '12345678' },
      },
      fields,
      { timeZone: tz },
    )
    expect(row).toEqual(['Ana', '+51911111111', 'ana@x.pe', null, 'VIP | Lima', 'whatsapp | instagram', null, '12345678', '2026-11-01 10:00:00', 'c1'])
    // A phone that starts with "+" is protected from spreadsheet formulas.
    expect(csvLine(row)).toContain("'+51911111111")
  })
})

describe('products CSV', () => {
  const p: BackupProduct = {
    name: 'Polo, algodón',
    description: 'Suave',
    price: 49.9,
    currency: 'PEN',
    compare_at_price: { toString: () => '59.90' },
    sku: 'POLO-1',
    stock: 12,
    category: 'Ropa',
    images: ['https://cdn.x/a.jpg', 'https://cdn.x/b.jpg'],
    tags: ['verano', 'nuevo'],
    is_featured: true,
    is_active: false,
    attributes: { material: 'algodón', tallas: ['S', 'M'], lavable: true },
    variants_count: 2,
    created_at: new Date('2026-11-01T15:00:00Z'),
  }

  it('importer headers, attribute columns, extras', () => {
    expect(productsHeader('es', ['material'])).toEqual([
      'nombre', 'descripcion', 'precio', 'moneda', 'precio anterior', 'sku', 'stock', 'categoria', 'imagenes', 'etiquetas', 'destacado', 'activo', 'material', 'variantes', 'creado',
    ])
    expect(productRow(p, ['material', 'tallas', 'lavable', 'missing'], { lang: 'es', timeZone: tz })).toEqual([
      'Polo, algodón', 'Suave', 49.9, 'PEN', 59.9, 'POLO-1', 12, 'Ropa', 'https://cdn.x/a.jpg | https://cdn.x/b.jpg', 'verano | nuevo', 'Sí', 'No', 'algodón', 'S, M', 'Sí', null, 2, '2026-11-01 10:00:00',
    ])
  })

  it.each(['es', 'en'] as const)('the catalog importer reads the file back (%s)', (lang) => {
    const header = productsHeader(lang, [])
    const mapping = guessMapping(header, [])
    expect(mapping.slice(0, 12)).toEqual(['name', 'description', 'price', 'currency', 'compare_at_price', 'sku', 'stock', 'category', 'images', 'tags', 'is_featured', 'is_active'])
    expect(mapping.slice(12)).toEqual(['', '']) // variants count and created date are ignored
    const { data, errors } = normalizeRow(applyMapping(productRow(p, [], { lang, timeZone: tz }), mapping), [], 2)
    expect(errors).toEqual([])
    expect(data).toMatchObject({
      name: 'Polo, algodón',
      price: 49.9,
      currency: 'PEN',
      compare_at_price: 59.9,
      sku: 'POLO-1',
      stock: 12,
      category: 'Ropa',
      images: ['https://cdn.x/a.jpg', 'https://cdn.x/b.jpg'],
      tags: ['verano', 'nuevo'],
      is_featured: true,
      is_active: false,
    })
  })

  it('variants: one row each with readable options', () => {
    expect(variantsHeader('en')[0]).toBe('Product')
    expect(optionsText({ Talla: 'M', Color: 'Rojo' })).toBe('Talla: M | Color: Rojo')
    expect(optionsText(null)).toBe('')
    expect(
      variantRow({ product_name: 'Polo', product_sku: 'POLO-1', name: 'M / Rojo', options: { Talla: 'M' }, sku: 'POLO-1-M', price: 49.9, stock: null, weight_kg: null, is_active: true }, 'es'),
    ).toEqual(['Polo', 'POLO-1', 'M / Rojo', 'Talla: M', 'POLO-1-M', 49.9, null, null, 'Sí'])
  })
})

describe('automations', () => {
  const a: BackupAutomation = {
    id: 'a1',
    name: 'Bienvenida',
    description: null,
    trigger_type: 'new_contact',
    trigger_config: { channel: 'whatsapp' },
    is_active: true,
    execution_count: 7,
    last_executed_at: null,
    created_at: '2026-11-01T15:00:00.000Z',
    updated_at: new Date('2026-11-02T15:00:00Z'),
    steps: [
      { id: 's2', parent_step_id: null, branch: null, step_type: 'add_tag', step_config: { tag: 'nuevo' }, position: 2 },
      { id: 's1', parent_step_id: null, branch: null, step_type: 'send_message', step_config: { text: 'Hola' }, position: 1 },
    ],
  }
  it('JSON keeps the full definition, steps in order', () => {
    const parsed = JSON.parse(automationsJson([a], new Date('2026-11-27T00:00:00Z')))
    expect(parsed.format).toBe('whasalia.automations')
    expect(parsed.version).toBe(1)
    expect(parsed.automations[0]).toMatchObject({ name: 'Bienvenida', trigger_type: 'new_contact', trigger_config: { channel: 'whatsapp' }, is_active: true, created_at: '2026-11-01T15:00:00.000Z', updated_at: '2026-11-02T15:00:00.000Z' })
    expect(parsed.automations[0].steps.map((s: { id: string }) => s.id)).toEqual(['s1', 's2'])
    expect(parsed.automations[0].steps[0].step_config).toEqual({ text: 'Hola' })
  })
  it('CSV summary', () => {
    expect(automationsHeader('es')).toEqual(['Nombre', 'Descripción', 'Disparador', 'Activa', 'Pasos', 'Ejecuciones', 'Última ejecución', 'Creada'])
    expect(automationRow(a, { lang: 'en', timeZone: tz })).toEqual(['Bienvenida', null, 'new_contact', 'Yes', 2, 7, '', '2026-11-01 10:00:00'])
  })
})

describe('templates CSV', () => {
  it('buttons as "type: text: value", both shapes', () => {
    expect(
      buttonsText([
        { type: 'quick_reply', text: 'Sí' },
        { type: 'url', text: 'Ver', value: 'https://x.pe' },
        { type: 'PHONE_NUMBER', text: 'Llamar', phone_number: '+51911111111' },
      ]),
    ).toBe('quick_reply: Sí | url: Ver: https://x.pe | PHONE_NUMBER: Llamar: +51911111111')
    expect(buttonsText(null)).toBe('')
  })
  it('row', () => {
    expect(templatesHeader('en')).toHaveLength(13)
    expect(
      templateRow(
        {
          name: 'promo',
          category: 'Marketing',
          language: 'es',
          status: 'Rejected',
          header_type: 'text',
          header_content: 'Hola {{1}}',
          header_media_url: null,
          body_text: 'Oferta\n=50%',
          footer_text: null,
          buttons: [],
          meta_template_id: '123',
          rejection_reason: 'INVALID_FORMAT',
          created_at: null,
        },
        { timeZone: tz },
      ),
    ).toEqual(['promo', 'Marketing', 'es', 'Rejected', 'text', 'Hola {{1}}', null, 'Oferta\n=50%', null, '', '123', 'INVALID_FORMAT', ''])
  })
})

describe('zip name and read-me', () => {
  it('names', () => {
    expect(zipFileName('es', '2026-11-27')).toBe('respaldo-whasalia-2026-11-27.zip')
    expect(zipFileName('en', '2026-11-27')).toBe('whasalia-backup-2026-11-27.zip')
  })
  it('describes only the chosen files', () => {
    const txt = readmeText({ lang: 'es', datasets: ['contacts', 'products'], generatedAt: new Date('2026-11-27T15:00:00Z'), timeZone: tz, from: null, to: null, includeInternal: false })
    expect(txt).toContain('2026-11-27 10:00:00')
    expect(txt).toContain('contactos.csv')
    expect(txt).toContain('productos-variantes.csv')
    expect(txt).not.toContain('conversaciones.csv')
    expect(txt).not.toContain('plantillas.csv')
    const en = readmeText({ lang: 'en', datasets: ['conversations'], generatedAt: new Date(), timeZone: tz, from: '2026-11-01', to: null, includeInternal: true })
    expect(en).toContain('conversations.csv')
    expect(en).toContain('2026-11-01 / …')
  })
})
