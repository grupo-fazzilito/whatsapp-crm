import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
// Pure tests: nothing here touches the database (the platform settings module imports the client).
vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))

import { productAttributesFor } from '@/lib/catalog/attributes'
import { productPayload } from '@/lib/catalog/import'
import { parseXml } from './feed/xml'
import { FeedError, parseCsv, parseFeed } from './feed/parse'
import { guessFeedMapping, recordToListing, sanitizeMapping } from './feed/mapping'
import { attrNumber, isRealEstateCategory, mapMlItem, type MlItem } from './mercadolibre/mapping'
import { mlEndpoints } from './mercadolibre/endpoints'
import { buildMlConfig } from './mercadolibre/config'
import { missingPatch, planExternalImport, type ExistingExternal } from './plan'
import { listingCurrency, normalizeCurrency, normalizeOption, parseMeasure } from './values'
import { signPortalState, verifyPortalState } from './state'
import { isPrivateAddress } from './net'
import { encrypt } from '@/lib/whatsapp/encryption'

const fields = productAttributesFor('real_estate', {} as never)

describe('xml parser', () => {
  it('reads elements, attributes, CDATA and entities; skips DOCTYPE', () => {
    const root = parseXml(`<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e "boom">]><a x="1 &amp; 2"><b><![CDATA[<hola> & co]]></b><c>caf&#233; &lt;3</c><d/></a>`)
    expect(root.name).toBe('a')
    expect(root.attrs.x).toBe('1 & 2')
    expect(root.children.map((c) => c.name)).toEqual(['b', 'c', 'd'])
    expect(root.children[0].text).toBe('<hola> & co')
    expect(root.children[1].text).toBe('café <3')
  })
  it('throws on broken structure', () => {
    expect(() => parseXml('<a><b></a')).toThrow()
    expect(() => parseXml('just text')).toThrow()
  })
})

const XML_FEED = `<?xml version="1.0" encoding="UTF-8"?>
<propiedades>
  <propiedad>
    <codigo>URB-1</codigo>
    <titulo>Depa en Miraflores</titulo>
    <operacion>Venta</operacion>
    <tipo>Depa</tipo>
    <precio moneda="USD">185,000</precio>
    <dormitorios>3</dormitorios>
    <banos>2</banos>
    <area>120 m2</area>
    <ubicacion><distrito>Miraflores</distrito><latitud>-12.12</latitud><longitud>-77.03</longitud></ubicacion>
    <fotos><foto>https://cdn.example.com/1.jpg</foto><foto>https://cdn.example.com/2.jpg</foto></fotos>
    <amenidades>Piscina, Gimnasio, Helipuerto</amenidades>
  </propiedad>
  <propiedad>
    <codigo>URB-2</codigo>
    <titulo>Casa en La Molina</titulo>
    <operacion>Alquiler</operacion>
    <tipo>Casa</tipo>
    <precio moneda="PEN">4.500</precio>
    <fotos><foto>https://cdn.example.com/3.jpg</foto></fotos>
  </propiedad>
</propiedades>`

describe('feed parsing', () => {
  it('detects the repeated listing element in XML and flattens paths', () => {
    const f = parseFeed(XML_FEED)
    expect(f.format).toBe('xml')
    expect(f.itemPath).toBe('propiedades/propiedad')
    expect(f.records).toHaveLength(2)
    expect(f.records[0]['fotos/foto']).toEqual(['https://cdn.example.com/1.jpg', 'https://cdn.example.com/2.jpg'])
    expect(f.records[0]['precio@moneda']).toBe('USD')
    expect(f.records[0]['ubicacion/distrito']).toBe('Miraflores')
    expect(f.records[1]['fotos/foto']).toBe('https://cdn.example.com/3.jpg')
  })

  it('finds the array of listings in JSON', () => {
    const f = parseFeed(JSON.stringify({ meta: { total: 2 }, objects: [{ id: 7, publication_title: 'A', photos: [{ image: 'https://x/1.jpg' }, { image: 'https://x/2.jpg' }] }, { id: 8, publication_title: 'B' }] }))
    expect(f.format).toBe('json')
    expect(f.itemPath).toBe('objects')
    expect(f.records[0]).toMatchObject({ id: '7', publication_title: 'A', 'photos/image': ['https://x/1.jpg', 'https://x/2.jpg'] })
  })

  it('parses CSV with quotes and semicolons', () => {
    expect(parseCsv('a;b\n"x; y";"he said ""hi"""\n')).toEqual([['a', 'b'], ['x; y', 'he said "hi"']])
    const f = parseFeed('codigo,titulo\nC1,Uno\nC2,"Dos, tres"\n')
    expect(f.format).toBe('csv')
    expect(f.records).toEqual([{ codigo: 'C1', titulo: 'Uno' }, { codigo: 'C2', titulo: 'Dos, tres' }])
  })

  it('reports empty / invalid input', () => {
    expect(() => parseFeed('   ')).toThrow(FeedError)
    expect(() => parseFeed('{ bad json')).toThrow(FeedError)
  })
})

describe('feed mapping', () => {
  it('auto-maps Spanish portal field names', () => {
    const f = parseFeed(XML_FEED)
    const m = guessFeedMapping(f.fields, fields)
    expect(m).toMatchObject({
      codigo: 'external_id',
      titulo: 'name',
      operacion: 'attr:operation',
      tipo: 'attr:property_type',
      precio: 'price',
      'precio@moneda': 'currency',
      dormitorios: 'attr:bedrooms',
      banos: 'attr:bathrooms',
      area: 'attr:area_m2',
      'ubicacion/distrito': 'attr:zone',
      'ubicacion/latitud': 'attr:latitude',
      'ubicacion/longitud': 'attr:longitude',
      'fotos/foto': 'images',
      amenidades: 'attr:amenities',
    })
  })

  it('auto-maps the "Plantilla portales inmobiliarios" headers', () => {
    const headers = ['codigo_aviso', 'titulo', 'descripcion', 'operacion', 'tipo_inmueble', 'precio', 'moneda', 'dormitorios', 'banos', 'area_construida_m2', 'estacionamientos', 'distrito', 'direccion', 'latitud', 'longitud', 'mantenimiento', 'piso', 'ano_construccion', 'amenidades', 'estado', 'fotos', 'video', 'url_aviso']
    const m = guessFeedMapping(headers, fields)
    expect(headers.filter((h) => !m[h])).toEqual([])
    expect(m.area_construida_m2).toBe('attr:area_m2')
    expect(m.estado).toBe('attr:listing_status')
    expect(m.url_aviso).toBe('external_url')
  })

  it('turns a record into a listing with coerced values', () => {
    const f = parseFeed(XML_FEED)
    const m = guessFeedMapping(f.fields, fields)
    const l = recordToListing(f.records[0], m, fields)!
    expect(l.externalId).toBe('URB-1')
    expect(l.currency).toBe('USD')
    expect(l.raw.images).toHaveLength(2)
    expect(l.raw.attributes).toMatchObject({
      operation: 'sale',
      property_type: 'apartment',
      bedrooms: 3,
      area_m2: 120,
      zone: 'Miraflores',
      latitude: -12.12,
      amenities: ['pool', 'gym'], // unknown "Helipuerto" dropped
    })
    expect(l.raw.price).toBe(185000)
    const l2 = recordToListing(f.records[1], m, fields)!
    expect(l2.raw.attributes).toMatchObject({ operation: 'rent', property_type: 'house' })
    expect(l2.raw.price).toBe(4500)
    expect(l2.currency).toBe('PEN')
  })

  it('caps photos at the catalog limit and drops invalid URLs', () => {
    const rec = { id: 'X', titulo: 'T', fotos: [...Array.from({ length: 25 }, (_, i) => `https://x/${i}.jpg`), 'not-a-url'] }
    const l = recordToListing(rec, { id: 'external_id', titulo: 'name', fotos: 'images' }, fields)!
    expect(l.raw.images).toHaveLength(10)
  })

  it('skips records without an external id and sanitizes mappings', () => {
    expect(recordToListing({ titulo: 'T' }, { titulo: 'name' }, fields)).toBeNull()
    expect(sanitizeMapping({ a: 'name', b: 'attr:nope', c: 'drop table', d: 'external_id' }, fields)).toEqual({ a: 'name', d: 'external_id' })
  })
})

describe('values', () => {
  it('normalizes portal vocabulary', () => {
    expect(normalizeOption('operation', 'Alquiler temporal')).toBe('rent')
    expect(normalizeOption('property_type', 'Local comercial')).toBe('commercial')
    expect(normalizeOption('property_type', 'Departamento en venta')).toBe('apartment')
    expect(normalizeOption('listing_status', 'Separada')).toBe('reserved')
    expect(parseMeasure('1.250 m²')).toBe(1250)
    expect(parseMeasure('120,5 m2')).toBe(120.5)
    expect(normalizeCurrency('US$')).toBe('USD')
    expect(normalizeCurrency('S/')).toBe('PEN')
  })

  it('maps the source currency to products.currency', () => {
    expect(listingCurrency('USD', 'PEN')).toEqual({ currency: 'USD', foreign: true })
    expect(listingCurrency('US$', 'PEN')).toEqual({ currency: 'USD', foreign: true })
    // Workspace currency → NULL (follows the workspace); unknown → leave as is.
    expect(listingCurrency('PEN', 'PEN')).toEqual({ currency: null, foreign: false })
    expect(listingCurrency(null, 'PEN')).toEqual({ currency: undefined, foreign: false })
  })
})

const ML_ITEM: MlItem = {
  id: 'MPE700000001',
  site_id: 'MPE',
  title: 'Departamento 3 dormitorios en San Isidro',
  category_id: 'MPE1474',
  price: 650000,
  currency_id: 'PEN',
  status: 'active',
  permalink: 'https://inmueble.mercadolibre.com.pe/MPE-700000001',
  video_id: 'dQw4w9WgXcQ',
  pictures: [{ id: 'p1', secure_url: 'https://http2.mlstatic.com/D_1.jpg', url: 'http://http2.mlstatic.com/D_1.jpg' }],
  attributes: [
    { id: 'OPERATION', value_id: '242075', value_name: 'Venta' },
    { id: 'PROPERTY_TYPE', value_id: '242062', value_name: 'Departamento' },
    { id: 'BEDROOMS', value_name: '3', value_struct: null },
    { id: 'FULL_BATHROOMS', value_name: '2' },
    { id: 'COVERED_AREA', value_name: '110 m²', value_struct: { number: 110, unit: 'm²' } },
    { id: 'TOTAL_AREA', value_name: '125 m²', value_struct: { number: 125, unit: 'm²' } },
    { id: 'PARKING_LOTS', value_name: '1' },
    { id: 'MAINTENANCE_FEE', value_name: '450 PEN', value_struct: { number: 450, unit: 'PEN' } },
    { id: 'PROPERTY_AGE', value_name: '5 años', value_struct: { number: 5, unit: 'años' } },
    { id: 'UNIT_FLOOR', value_name: '8' },
    { id: 'HAS_SWIMMING_POOL', value_id: '242085', value_name: 'Sí' },
    { id: 'HAS_LIFT', value_name: 'Sí' },
    { id: 'HAS_GYM', value_name: 'No' },
  ],
  location: {
    address_line: 'Av. Javier Prado Oeste 123',
    neighborhood: { id: 'x', name: 'San Isidro' },
    city: { id: 'y', name: 'Lima' },
    state: { id: 'z', name: 'Lima' },
    latitude: -12.0931,
    longitude: -77.0465,
  },
}

describe('mercado libre mapping', () => {
  it('maps attributes, location, pictures and video', () => {
    const l = mapMlItem(ML_ITEM, 'Hermoso departamento.', fields, { now: new Date('2026-10-08T00:00:00Z'), parentCategoryId: 'MPE1472' })
    expect(l.externalId).toBe('MPE700000001')
    expect(l.externalUrl).toBe(ML_ITEM.permalink)
    expect(l.currency).toBe('PEN')
    expect(l.raw).toMatchObject({ name: ML_ITEM.title, description: 'Hermoso departamento.', price: 650000, images: ['https://http2.mlstatic.com/D_1.jpg'] })
    expect(l.raw.attributes).toEqual({
      operation: 'sale',
      property_type: 'apartment',
      bedrooms: 3,
      bathrooms: 2,
      area_m2: 110,
      parking: 1,
      zone: 'San Isidro',
      address: 'Av. Javier Prado Oeste 123, San Isidro, Lima',
      latitude: -12.0931,
      longitude: -77.0465,
      amenities: ['pool', 'elevator'],
      maintenance_fee: 450,
      year_built: 2021,
      floor: 8,
      video_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    })
  })

  it('falls back to the category for the property type and rent ids', () => {
    const item: MlItem = { id: 'MPE2', title: 'Casa', category_id: 'MPE123225', attributes: [{ id: 'OPERATION', value_id: '242074', value_name: 'Alquiler temporal' }] }
    const l = mapMlItem(item, null, fields, { parentCategoryId: 'MPE1466' })
    expect(l.raw.attributes).toMatchObject({ operation: 'rent', property_type: 'house' })
  })

  it('reads numbers from value_struct, names and hectares', () => {
    expect(attrNumber({ id: 'TOTAL_AREA', value_name: '2 ha', value_struct: { number: 2, unit: 'ha' } })).toBe(20000)
    expect(attrNumber({ id: 'BEDROOMS', value_name: '4' })).toBe(4)
    expect(attrNumber(undefined)).toBeNull()
  })

  it('recognises real-estate categories by their root', () => {
    expect(isRealEstateCategory([{ id: 'MPE1459' }, { id: 'MPE1472' }, { id: 'MPE1474' }])).toBe(true)
    expect(isRealEstateCategory([{ id: 'MPE1051' }])).toBe(false)
  })
})

const existing = (id: string, externalId: string, extra: Partial<ExistingExternal> = {}): ExistingExternal => ({
  id,
  externalId,
  attributes: { operation: 'sale', listing_status: 'reserved' },
  images: [],
  isActive: true,
  missingSince: null,
  ...extra,
})

describe('upsert by external id', () => {
  const opts = { fields, workspaceCurrency: 'PEN', deactivateMissing: true }

  it('creates new ids, updates known ones and flags disappeared listings', () => {
    const listings = [
      { externalId: 'A', raw: { name: 'A', attributes: { operation: 'sale' } } },
      { externalId: 'B', raw: { name: 'B' } },
      { externalId: 'C', raw: { name: 'C' } }, // new without required operation
      { externalId: 'A', raw: { name: 'A again', attributes: { operation: 'sale' } } },
    ]
    const plan = planExternalImport(listings, [existing('p-b', 'B'), existing('p-z', 'Z'), existing('p-old', 'OLD', { missingSince: '2026-01-01' })], opts)
    expect(plan.rows.map((r) => r.action)).toEqual(['create', 'update', 'error', 'error'])
    expect(plan.rows[0].data.attributes).toMatchObject({ listing_status: 'available' })
    expect(plan.rows[1].productId).toBe('p-b')
    // An update without listing_status keeps the agency's own status (merged later).
    expect(plan.rows[1].data.attributes?.listing_status).toBeUndefined()
    expect(plan.rows[2].errors).toContainEqual({ field: 'attr:operation', code: 'required' })
    expect(plan.rows[3].errors).toContainEqual({ field: 'external_id', code: 'duplicate' })
    // Z disappeared; OLD was already marked missing.
    expect(plan.missing.map((m) => m.id)).toEqual(['p-z'])
  })

  it('does not plan deactivations for partial sources', () => {
    const plan = planExternalImport([{ externalId: 'A', raw: { name: 'A', attributes: { operation: 'sale' } } }], [existing('p-z', 'Z')], { ...opts, deactivateMissing: false })
    expect(plan.missing).toEqual([])
  })

  it('keeps a USD sale price with its own currency (no description workaround)', () => {
    const plan = planExternalImport(
      [
        { externalId: 'B', currency: 'USD', raw: { name: 'B', price: 350000, description: 'Lindo' } },
        { externalId: 'R', currency: 'PEN', raw: { name: 'R', price: 2800, attributes: { operation: 'rent' } } },
      ],
      [existing('p-b', 'B')],
      opts,
    )
    expect(plan.foreignCurrency).toBe(1)
    expect(plan.rows[0].data).toMatchObject({ price: 350000, currency: 'USD', description: 'Lindo' })
    // Workspace currency is stored as NULL (an update also clears an old USD).
    expect(plan.rows[1].data).toMatchObject({ price: 2800, currency: null })
    const payload = productPayload(plan.rows[0].data, undefined, 'update', {})
    expect(payload).toMatchObject({ price: 350000, currency: 'USD' })
  })

  it('deactivates missing listings without deleting them', () => {
    const patch = missingPatch(fields, { operation: 'sale' }, '2026-10-08T00:00:00.000Z')
    expect(patch).toMatchObject({ is_active: false, external_missing_since: '2026-10-08T00:00:00.000Z' })
    // listing_status only gets 'inactive' when the field offers that option.
    const withInactive = fields.map((f) => (f.key === 'listing_status' ? { ...f, options: [...(f.options ?? []), { value: 'inactive', label: { es: 'Inactiva', en: 'Inactive' } }] } : f))
    expect(missingPatch(withInactive, { operation: 'sale' }, 'now').attributes).toEqual({ operation: 'sale', listing_status: 'inactive' })
  })
})

describe('oauth state, endpoints and config', () => {
  const secret = Buffer.from('k'.repeat(32))
  it('signs and verifies state', () => {
    const s = signPortalState({ w: 'ws', u: 'user', p: 'mercadolibre' }, secret, 1000)
    const ok = verifyPortalState(s, secret, 2000)
    expect(ok.ok && ok.state.w).toBe('ws')
    expect(verifyPortalState(s, Buffer.from('x'.repeat(32)), 2000)).toEqual({ ok: false, reason: 'signature' })
    expect(verifyPortalState(s, secret, 1000 + 11 * 60 * 1000)).toEqual({ ok: false, reason: 'expired' })
    expect(verifyPortalState(`${s}x`, secret, 2000).ok).toBe(false)
  })

  it('ignores the mock base URL in production', () => {
    expect(mlEndpoints('MPE', 'http://127.0.0.1:9', 'production').api).toBe('https://api.mercadolibre.com')
    expect(mlEndpoints('MPE', null, 'development').authorize).toBe('https://auth.mercadolibre.com.pe/authorization')
    expect(mlEndpoints('MPE', 'http://127.0.0.1:9/', 'development')).toMatchObject({ api: 'http://127.0.0.1:9', token: 'http://127.0.0.1:9/oauth/token', mock: true })
  })

  it('prefers panel credentials over env and decrypts the secret', () => {
    const env = { MERCADOLIBRE_CLIENT_ID: '111', MERCADOLIBRE_CLIENT_SECRET: 'envsecret', NEXT_PUBLIC_SITE_URL: 'https://app.example.com', NODE_ENV: 'production' }
    expect(buildMlConfig(null, env)).toMatchObject({ clientId: '111', clientSecret: 'envsecret', source: 'env', site: 'MPE' })
    const panel = buildMlConfig({ client_id: '222', client_secret: encrypt('panelsecret'), site_id: 'MLA', dev_mock_url: 'http://127.0.0.1:1' }, env)
    expect(panel).toMatchObject({ clientId: '222', clientSecret: 'panelsecret', source: 'panel', site: 'MLA' })
    expect(panel.redirectUri).toBe('https://app.example.com/api/real-estate/portals/mercadolibre/callback')
    expect(panel.endpoints.mock).toBe(false)
  })
})

describe('outbound URL guard', () => {
  it('blocks private, loopback, link-local and metadata addresses', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true)
    }
    for (const ip of ['8.8.8.8', '190.12.34.56', '2800:200::1']) expect(isPrivateAddress(ip), ip).toBe(false)
  })
})
