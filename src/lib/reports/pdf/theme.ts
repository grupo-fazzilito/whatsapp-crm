// Colors and text helpers of the PDF report.

export const C = {
  primary: '#0f9d74',
  primaryDark: '#0b6e52',
  primarySoft: '#e7f6f0',
  blue: '#3b6fd8',
  violet: '#8b5cf6',
  amber: '#e09b20',
  red: '#d9534f',
  slate: '#94a3b8',
  text: '#1e293b',
  muted: '#64748b',
  grid: '#e8edf3',
  card: '#f7f9fb',
  white: '#ffffff',
} as const

/**
 * The PDF uses the built-in Helvetica (WinAnsi): characters outside it
 * (≤, →, emoji, other scripts) would print as garbage, so they are
 * replaced or dropped.
 */
export function pdfText(s: string | null | undefined): string {
  if (!s) return ''
  return s
    .replace(/≤/g, '<=')
    .replace(/≥/g, '>=')
    .replace(/[→⟶]/g, '->')
    .replace(/[   ]/g, ' ')
    .replace(/[^\x09\x0A\x0D\x20-\x7E -ÿ–—‘’“”•…€]/g, '')
}
