import { describe, expect, it } from 'vitest'
import { coordsFrom, googleMapsUrl, isValidLatLng, osmEmbedUrl, parseCoordinates } from './geo'
import { listingStatusOf, isHiddenStatus, safeHttpUrl, waDigits, waMeLink } from './status'
import { propertyPath, propertyUrl } from './url'
import { productAttributesFor, validateAttributes } from '@/lib/catalog/attributes'

describe('parseCoordinates', () => {
  it('reads the exact pin of a Google Maps place link', () => {
    const url = 'https://www.google.com/maps/place/Parque+Kennedy/@-12.1211,-77.0297,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-12.1219174!4d-77.0300916'
    expect(parseCoordinates(url)).toEqual({ lat: -12.1219174, lng: -77.0300916 })
  })
  it('reads @lat,lng, q= and plain pairs', () => {
    expect(parseCoordinates('https://www.google.com/maps/@-12.0464,-77.0428,15z')).toEqual({ lat: -12.0464, lng: -77.0428 })
    expect(parseCoordinates('https://maps.google.com/?q=-12.1,-77.03')).toEqual({ lat: -12.1, lng: -77.03 })
    expect(parseCoordinates('-12.12, -77.03')).toEqual({ lat: -12.12, lng: -77.03 })
    expect(parseCoordinates('https://www.openstreetmap.org/?mlat=-12.1&mlon=-77.02#map=17/-12.1/-77.02')).toEqual({ lat: -12.1, lng: -77.02 })
  })
  it('rejects text without valid coordinates', () => {
    expect(parseCoordinates('https://maps.app.goo.gl/abc123')).toBeNull()
    expect(parseCoordinates('Av. Larco 123')).toBeNull()
    expect(parseCoordinates('95, 200')).toBeNull()
  })
})

describe('geo helpers', () => {
  it('validates ranges and the 0,0 placeholder', () => {
    expect(isValidLatLng(-12, -77)).toBe(true)
    expect(isValidLatLng(0, 0)).toBe(false)
    expect(isValidLatLng(91, 0)).toBe(false)
  })
  it('reads coordinates from attributes (numbers or strings)', () => {
    expect(coordsFrom({ latitude: -12.1, longitude: '-77.03' })).toEqual({ lat: -12.1, lng: -77.03 })
    expect(coordsFrom({ latitude: -12.1 })).toBeNull()
  })
  it('builds OSM embed and Google Maps links without keys', () => {
    const src = osmEmbedUrl({ lat: -12.1, lng: -77.03 })
    expect(src).toMatch(/^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=/)
    expect(src).toContain('marker=-12.1%2C-77.03')
    expect(googleMapsUrl({ lat: -12.1, lng: -77.03 })).toBe('https://www.google.com/maps/search/?api=1&query=-12.1%2C-77.03')
    expect(googleMapsUrl('Av. Larco 123, Miraflores')).toContain('query=Av.%20Larco%20123%2C%20Miraflores')
  })
})

describe('listing status', () => {
  it('defaults to available and flags sold/rented as hidden', () => {
    expect(listingStatusOf({})).toBe('available')
    expect(listingStatusOf({ listing_status: 'bogus' })).toBe('available')
    expect(listingStatusOf({ listing_status: 'reserved' })).toBe('reserved')
    expect(isHiddenStatus('sold')).toBe(true)
    expect(isHiddenStatus('rented')).toBe(true)
    expect(isHiddenStatus('reserved')).toBe(false)
  })
})

describe('wa.me links', () => {
  it('adds the workspace dial code to local numbers', () => {
    expect(waDigits('987 654 321', '51')).toBe('51987654321')
    expect(waDigits('+51 987-654-321', '51')).toBe('51987654321')
    expect(waDigits('0051987654321', '51')).toBe('51987654321')
    expect(waDigits('123', '51')).toBeNull()
    expect(waDigits(null, '51')).toBeNull()
  })
  it('encodes the prefilled text', () => {
    expect(waMeLink('51987654321', 'Hola «Depa»')).toBe('https://wa.me/51987654321?text=Hola%20%C2%ABDepa%C2%BB')
  })
  it('accepts only http(s) media links', () => {
    expect(safeHttpUrl('https://youtu.be/x')).toBe('https://youtu.be/x')
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(safeHttpUrl('')).toBeNull()
  })
})

describe('propertyUrl', () => {
  it('builds /p/<slug>/<id> on the site origin', () => {
    expect(propertyPath({ slug: 'inmo-abc123' }, { id: '00000000-0000-0000-0000-000000000001' })).toBe('/p/inmo-abc123/00000000-0000-0000-0000-000000000001')
    expect(propertyUrl({ slug: 'x' }, { id: 'y' })).toMatch(/^https?:\/\/[^/]+\/p\/x\/y$/)
  })
})

describe('real-estate preset attributes', () => {
  const fields = productAttributesFor('real_estate', null)
  it('includes the listing sheet fields', () => {
    for (const k of ['listing_status', 'address', 'latitude', 'longitude', 'amenities', 'maintenance_fee', 'year_built', 'floor', 'video_url', 'virtual_tour_url']) {
      expect(fields.some((f) => f.key === k)).toBe(true)
    }
    expect(fields.find((f) => f.key === 'listing_status')?.filterable).toBe(true)
  })
  it('validates status and amenities by label', () => {
    const { values, errors } = validateAttributes(fields, {
      operation: 'Alquiler',
      listing_status: 'Separada',
      amenities: 'Piscina, gimnasio, Pet friendly',
      latitude: '-12.12',
      maintenance_fee: '350',
    })
    expect(errors).toEqual({})
    expect(values).toMatchObject({ operation: 'rent', listing_status: 'reserved', amenities: ['pool', 'gym', 'pet_friendly'], latitude: -12.12, maintenance_fee: 350 })
  })
})
