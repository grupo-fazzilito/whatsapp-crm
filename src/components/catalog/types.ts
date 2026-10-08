import type { AttributeField } from '@/lib/industries';
import type { AttributeValue } from '@/lib/catalog/attributes';

export const CATALOG_BUCKET = 'catalog';
export const PAGE_SIZE = 50;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface Category {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  is_active: boolean;
}

export interface Product {
  id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number | null;
  compare_at_price: number | null;
  /** ISO 4217; null = workspace currency. */
  currency?: string | null;
  sku: string | null;
  stock: number | null;
  track_stock: boolean;
  images: string[];
  tags: string[];
  attributes: Record<string, AttributeValue>;
  is_active: boolean;
  is_featured: boolean;
  sort_order: number;
  /** From the `product_variants(count)` embed. */
  product_variants?: { count: number }[];
}

export interface Variant {
  id: string;
  product_id: string;
  name: string;
  options: Record<string, string>;
  sku: string | null;
  price: number | null;
  stock: number | null;
  is_active: boolean;
  sort_order: number;
}

/** Industries where variants (size, color, portion...) are shown by default. */
export const VARIANT_INDUSTRIES = ['store', 'restaurant'];

/** Path inside the catalog bucket for a public object URL, or null if it is external. */
export function storagePathFromUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${CATALOG_BUCKET}/`;
  const i = url.indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split('?')[0]) : null;
}

/** Human text for one attribute value, using option labels and units. */
export function formatAttribute(field: AttributeField, value: AttributeValue | undefined, locale: 'es' | 'en', yes: string): string | null {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) return null;
  const opt = (v: string) => field.options?.find((o) => o.value === v)?.label[locale] ?? v;
  switch (field.type) {
    case 'boolean':
      return value === true ? `${field.label[locale]}: ${yes}` : null;
    case 'select':
      return opt(String(value));
    case 'multiselect':
      return (Array.isArray(value) ? value : [String(value)]).map(opt).join(', ');
    case 'number':
      return `${field.label[locale]}: ${value}${field.unit ? ` ${field.unit}` : ''}`;
    default:
      return String(value);
  }
}

/** Escape LIKE wildcards in user input. */
export const likeEscape = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/**
 * PostgREST `or` filter for the catalog search box: name or SKU substring
 * (ILIKE) or a prefix match on every word against products.search, which
 * is stored lowercase and without accents ("organica" finds "Orgánica").
 */
export function productSearchFilter(text: string): string {
  const safe = text.replace(/["\\]/g, ' ').trim();
  const words = safe
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w.length > 1);
  const like = `"%${likeEscape(safe)}%"`;
  const byName = `name.ilike.${like},sku.ilike.${like}`;
  return words.length ? `${byName},search.fts(simple).${words.map((w) => `${w}:*`).join('&')}` : byName;
}
