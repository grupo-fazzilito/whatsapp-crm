import 'server-only'
import { cache } from 'react'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { isUuid } from '@/lib/workspace/constants'
import { countryDefaults } from '@/lib/workspace/countries'
import { originAllowed } from '@/lib/webchat/server'
import type { ChannelRow } from '@/lib/channels'
import type { WorkspaceSettings } from '@/lib/workspace/types'
import { effectiveCurrency } from '@/lib/catalog/currency'
import { siteUrl } from './url'
import { waDigits } from './status'

export interface PublicListingWorkspace {
  id: string
  name: string
  slug: string
  industry: string
  locale: 'es' | 'en'
  country: string | null
  currency: string
  logo_url: string | null
  settings: WorkspaceSettings
}

export interface PublicListing {
  workspace: PublicListingWorkspace
  product: {
    id: string
    name: string
    description: string | null
    price: number | null
    /** Effective ISO currency of the price (own or the workspace's). */
    currency: string
    images: string[]
    attributes: Record<string, unknown>
    category: string | null
    updated_at: string | null
  }
  /** wa.me digits (connected WhatsApp number, else the workspace phone). */
  whatsapp: string | null
  /** Public key of a connected web chat channel that accepts this site. */
  webchatKey: string | null
  noindex: boolean
}

/** Real-estate settings stored in workspaces.settings.real_estate. */
export interface RealEstateSettings {
  /** Ask search engines not to index public property pages. */
  listing_noindex?: boolean
}

export function realEstateSettings(settings: WorkspaceSettings | null | undefined): RealEstateSettings {
  const v = settings?.real_estate
  return v && typeof v === 'object' ? (v as RealEstateSettings) : {}
}

/**
 * Active listing of a real-estate workspace for the public page, or null
 * (unknown slug, inactive/sold/rented listing, or another industry).
 * Cached per request so generateMetadata and the page share one load.
 */
export const loadPublicListing = cache(async (slug: string, productId: string): Promise<PublicListing | null> => {
  if (!slug || slug.length > 120 || !isUuid(productId)) return null
  // Public page: the workspace is only known by its slug (platform lookup).
  const ws = await prisma.workspaces
    .findFirst({
      select: { id: true, name: true, slug: true, industry: true, locale: true, country: true, currency: true, logo_url: true, phone: true, settings: true },
      where: { slug },
    })
    .catch(() => null)
  if (!ws || ws.industry !== 'real_estate') return null

  const db = tenantDb(ws.id)
  const [row, channels] = await Promise.all([
    db.products
      .findFirst({
        select: {
          id: true,
          name: true,
          description: true,
          price: true,
          currency: true,
          images: true,
          attributes: true,
          updated_at: true,
          product_categories: { select: { name: true } },
        },
        where: { id: productId, is_active: true },
      })
      .catch(() => null),
    db.channels
      .findMany({
        select: { id: true, workspace_id: true, type: true, external_id: true, display_handle: true, status: true, settings: true },
        where: { type: { in: ['whatsapp', 'webchat'] }, status: 'connected' },
        orderBy: { created_at: 'asc' },
      })
      .catch(() => null),
  ])
  if (!row) return null
  const { product_categories, ...product } = row

  const dial = countryDefaults(ws.country).dialCode
  const wa = (channels ?? []).find((c) => c.type === 'whatsapp' && waDigits(c.display_handle, dial))
  const whatsapp = waDigits(wa?.display_handle, dial) ?? waDigits(ws.phone, dial)

  const origin = new URL(siteUrl()).origin
  const webchat = (channels ?? []).find((c) => c.type === 'webchat' && originAllowed(c as unknown as ChannelRow, origin))

  const settings = (ws.settings ?? {}) as WorkspaceSettings
  const category = product_categories
  return {
    workspace: {
      id: ws.id,
      name: ws.name,
      slug: ws.slug,
      industry: ws.industry,
      locale: ws.locale === 'en' ? 'en' : 'es',
      country: ws.country,
      currency: ws.currency,
      logo_url: ws.logo_url,
      settings,
    },
    product: {
      id: product.id,
      name: product.name,
      description: product.description,
      price: product.price === null ? null : Number(product.price),
      currency: effectiveCurrency(product, ws.currency),
      images: (product.images ?? []).filter((u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u)),
      attributes: (product.attributes ?? {}) as Record<string, unknown>,
      category: category?.name ?? null,
      updated_at: product.updated_at,
    },
    whatsapp,
    webchatKey: webchat?.external_id ?? null,
    noindex: realEstateSettings(settings).listing_noindex === true,
  }
})
