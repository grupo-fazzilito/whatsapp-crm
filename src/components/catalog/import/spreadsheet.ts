'use client';

import type { AttributeField } from '@/lib/industries';
import { FIXED_TARGETS, TEMPLATE_HEADERS, exampleAttributeValue, type FixedTarget } from '@/lib/catalog/import';

// xlsx is loaded on demand so the catalog page doesn't ship it until the
// admin actually imports or downloads a template.
const loadXlsx = () => import('xlsx');

export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export function isSpreadsheet(file: File): boolean {
  return /\.(csv|xlsx|xls)$/i.test(file.name);
}

/** First sheet as a matrix; index i is spreadsheet line i + 1. */
export async function readMatrix(file: File): Promise<unknown[][]> {
  const XLSX = await loadXlsx();
  const csv = /\.csv$/i.test(file.name);
  // CSV as text (UTF-8, keeps "00123" SKUs as text); Excel as binary.
  const wb = csv
    ? XLSX.read(await file.text(), { type: 'string', raw: true })
    : XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', raw: true, blankrows: true });
  const firstRow = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s.r : 0;
  return [...Array.from({ length: firstRow }, () => [] as unknown[]), ...rows];
}

export interface TemplateExample {
  name: string;
  description: string;
  category: string;
  tags: string;
  yes: string;
}

/** Downloads an .xlsx with the fixed columns + attribute keys and one example row. */
export async function downloadTemplate(fields: AttributeField[], locale: 'es' | 'en', example: TemplateExample, fileName: string) {
  const XLSX = await loadXlsx();
  const sample: Record<FixedTarget, string | number> = {
    name: example.name,
    description: example.description,
    price: 25,
    compare_at_price: '',
    sku: 'SKU-001',
    stock: 10,
    category: example.category,
    images: 'https://example.com/foto-1.jpg | https://example.com/foto-2.jpg',
    tags: example.tags,
    is_featured: 'no',
    is_active: example.yes,
  };
  const headers = [...FIXED_TARGETS.map((t) => TEMPLATE_HEADERS[locale][t]), ...fields.map((f) => f.key)];
  const row = [...FIXED_TARGETS.map((t) => sample[t]), ...fields.map((f) => exampleAttributeValue(f, locale))];
  const sheet = XLSX.utils.aoa_to_sheet([headers, row]);
  sheet['!cols'] = headers.map((h) => ({ wch: Math.max(12, h.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Catalog');
  XLSX.writeFile(wb, `${fileName}.xlsx`);
}
