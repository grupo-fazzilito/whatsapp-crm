import { describe, expect, it } from 'vitest'
import {
  captureAttributes,
  captureTitle,
  classifyPhotoRef,
  normalizeCaptureFields,
  normalizePhotoRef,
  normalizePhotoRefs,
  normalizePropertyType,
  parseAmount,
  type PropertyCapture,
} from './captures-core'
import { REAL_ESTATE_STAGE_KEYS, isRealEstateStageKey, stageRank } from './pipeline-keys'

describe('parseAmount', () => {
  it('reads localized amounts', () => {
    expect(parseAmount('350,000')).toBe(350000)
    expect(parseAmount('S/ 350.000')).toBe(350000)
    expect(parseAmount('1.200.000')).toBe(1200000)
    expect(parseAmount('1,200,000.50')).toBe(1200000.5)
    expect(parseAmount('1.200.000,50')).toBe(1200000.5)
    expect(parseAmount('85,5')).toBe(85.5)
    expect(parseAmount('120')).toBe(120)
    expect(parseAmount(95)).toBe(95)
    expect(parseAmount('')).toBeNull()
    expect(parseAmount(undefined)).toBeUndefined()
    expect(Number.isNaN(parseAmount('mucho') as number)).toBe(true)
  })
})

describe('normalizePropertyType', () => {
  it('maps labels and common words to preset values', () => {
    expect(normalizePropertyType('Departamento')).toBe('apartment')
    expect(normalizePropertyType('depa en Miraflores')).toBe('apartment')
    expect(normalizePropertyType('house')).toBe('house')
    expect(normalizePropertyType('Lote')).toBe('land')
    expect(normalizePropertyType('Casa de playa')).toBe('house')
    expect(normalizePropertyType('Galpón')).toBe('Galpón')
  })
})

describe('normalizeCaptureFields', () => {
  it('normalizes AI-ish input', () => {
    const { values, errors } = normalizeCaptureFields({
      owner_name: '  Rosa   Díaz ',
      operation: 'venta',
      property_type: 'depa',
      area_m2: '120,5',
      bedrooms: '3',
      expected_price: 'US$ 250,000',
      currency: 'us$',
      district: 'Miraflores',
      photos: ['https://cdn.x/1.jpg', 'https://cdn.x/1.jpg', 'javascript:x', '/api/media/ch-1/med_2'],
      junk: 'dropped',
    })
    expect(errors).toEqual({})
    expect(values).toEqual({
      owner_name: 'Rosa Díaz',
      operation: 'sale',
      property_type: 'apartment',
      area_m2: 120.5,
      bedrooms: 3,
      expected_price: 250000,
      currency: 'USD',
      district: 'Miraflores',
      photos: ['https://cdn.x/1.jpg', '/api/media/ch-1/med_2'],
    })
  })
  it('reports invalid values and keeps explicit nulls', () => {
    const { values, errors } = normalizeCaptureFields({ operation: 'permuta', bedrooms: -1, status: 'x', notes: null, assigned_user_id: 'nope' })
    expect(errors).toEqual({ operation: 'invalid', bedrooms: 'number', status: 'invalid', assigned_user_id: 'invalid' })
    expect(values.notes).toBeNull()
  })
})

describe('photo references', () => {
  it('stores signed attachment URLs as stable sb:// refs', () => {
    const signed = 'http://127.0.0.1:54321/storage/v1/object/sign/attachments/ws1/webchat/c1/a%20b.jpg?token=abc'
    expect(normalizePhotoRef(signed)).toBeNull() // space is not a safe path char
    const ok = 'http://127.0.0.1:54321/storage/v1/object/sign/attachments/ws1/webchat/c1/ab.jpg?token=abc'
    expect(normalizePhotoRef(ok)).toBe('sb://attachments/ws1/webchat/c1/ab.jpg')
    expect(normalizePhotoRef('sb://attachments/../etc/passwd')).toBeNull()
  })
  it('classifies refs', () => {
    expect(classifyPhotoRef('sb://attachments/ws1/captures/x.jpg')).toEqual({ kind: 'attachment', path: 'ws1/captures/x.jpg' })
    expect(classifyPhotoRef('/api/media/ch1/m1')).toMatchObject({ kind: 'proxy', channelId: 'ch1', mediaId: 'm1' })
    expect(classifyPhotoRef('http://127.0.0.1:54321/storage/v1/object/public/catalog/ws1/products/a.jpg')).toMatchObject({ kind: 'catalog', path: 'ws1/products/a.jpg' })
    expect(classifyPhotoRef('https://cdn.example.com/a.jpg')).toEqual({ kind: 'external', url: 'https://cdn.example.com/a.jpg' })
    expect(classifyPhotoRef('ftp://x')).toBeNull()
  })
  it('caps and dedupes', () => {
    const many = Array.from({ length: 40 }, (_, i) => `https://cdn.x/${i}.jpg`)
    expect(normalizePhotoRefs([...many, ...many])).toHaveLength(30)
  })
})

describe('publishing helpers', () => {
  const cap = {
    operation: 'sale',
    property_type: 'apartment',
    district: 'Miraflores',
    address: 'Av. Larco 123',
    bedrooms: 3,
    bathrooms: 2,
    area_m2: 120,
    parking: 1,
  } as unknown as PropertyCapture
  it('titles the listing', () => {
    expect(captureTitle(cap, 'es')).toBe('Departamento en venta en Miraflores')
    expect(captureTitle(cap, 'en')).toBe('Apartment for sale in Miraflores')
    expect(captureTitle({ operation: null, property_type: null, district: null }, 'es')).toBe('Propiedad')
  })
  it('maps capture data to listing attributes', () => {
    expect(captureAttributes(cap)).toEqual({
      listing_status: 'available',
      operation: 'sale',
      property_type: 'apartment',
      bedrooms: 3,
      bathrooms: 2,
      area_m2: 120,
      parking: 1,
      zone: 'Miraflores',
      address: 'Av. Larco 123',
    })
  })
})

describe('pipeline keys', () => {
  it('orders the funnel', () => {
    expect(REAL_ESTATE_STAGE_KEYS).toEqual(['new', 'qualified', 'viewing_scheduled', 'viewed', 'negotiation', 'reservation', 'won'])
    expect(stageRank('viewed')).toBeGreaterThan(stageRank('viewing_scheduled'))
    expect(stageRank('nope')).toBe(-1)
    expect(isRealEstateStageKey('won')).toBe(true)
    expect(isRealEstateStageKey('lost')).toBe(false)
  })
})
