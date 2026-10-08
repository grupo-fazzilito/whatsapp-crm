import { describe, expect, it } from 'vitest'
import { csvEscape, csvFileName, toCsv } from './csv'

describe('csv', () => {
  it('escapes quotes, separators and newlines', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
    expect(csvEscape('x\ny')).toBe('"x\ny"')
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(12.5)).toBe('12.5')
    expect(csvEscape(-3)).toBe('-3')
  })
  it('neutralises formulas in text cells', () => {
    expect(csvEscape('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvEscape('+51 999')).toBe("'+51 999")
  })
  it('builds a BOM-prefixed CRLF document', () => {
    expect(toCsv(['a', 'b'], [[1, 'x'], [null, 'y']])).toBe('﻿a,b\r\n1,x\r\n,y\r\n')
  })
  it('makes safe file names', () => {
    expect(csvFileName('Equipo / agentes', '2026-10-01', '2026-10-07')).toBe('equipo-agentes-2026-10-01_2026-10-07.csv')
  })
})
