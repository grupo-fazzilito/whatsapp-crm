// CSV export for report tables (Excel-friendly: BOM + CRLF).

export type CsvCell = string | number | null | undefined

export function csvEscape(v: CsvCell): string {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v)
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = `'${s}`
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header, ...rows].map((r) => r.map(csvEscape).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}

/** Safe file name: report-volume-2026-10-01_2026-10-07.csv */
export function csvFileName(table: string, fromDate: string, toDate: string): string {
  const slug = table.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'report'
  return `${slug}-${fromDate}_${toDate}.csv`
}
