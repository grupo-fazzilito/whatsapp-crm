// Minimal, dependency-free XML reader for listing feeds. Pure and
// client-safe. Supports elements, attributes, text, CDATA, comments,
// processing instructions, DOCTYPE (skipped, never expanded — no XXE) and
// the predefined + numeric entities. Not a validating parser: it is
// lenient with sloppy feeds but throws on structurally broken input.

export interface XmlNode {
  name: string
  attrs: Record<string, string>
  children: XmlNode[]
  text: string
}

export class XmlError extends Error {}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }

export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return NAMED[e] ?? m
  })
}

/** Local name without namespace prefix ("g:price" → "price"). */
export const localName = (n: string) => (n.includes(':') ? n.slice(n.indexOf(':') + 1) : n)

const MAX_DEPTH = 64

export function parseXml(input: string): XmlNode {
  const src = input.replace(/^﻿/, '')
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' }
  const stack: XmlNode[] = [root]
  let i = 0
  const n = src.length

  const top = () => stack[stack.length - 1]

  while (i < n) {
    const lt = src.indexOf('<', i)
    if (lt < 0) {
      top().text += decodeEntities(src.slice(i))
      break
    }
    if (lt > i) top().text += decodeEntities(src.slice(i, lt))
    i = lt

    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4)
      if (end < 0) throw new XmlError('Unterminated comment')
      i = end + 3
    } else if (src.startsWith('<![CDATA[', i)) {
      const end = src.indexOf(']]>', i + 9)
      if (end < 0) throw new XmlError('Unterminated CDATA')
      top().text += src.slice(i + 9, end)
      i = end + 3
    } else if (src.startsWith('<?', i)) {
      const end = src.indexOf('?>', i + 2)
      if (end < 0) throw new XmlError('Unterminated processing instruction')
      i = end + 2
    } else if (src.startsWith('<!', i)) {
      // DOCTYPE (possibly with an internal subset in [...]) — skipped.
      let depth = 0
      let j = i + 2
      for (; j < n; j++) {
        const c = src[j]
        if (c === '[') depth++
        else if (c === ']') depth--
        else if (c === '>' && depth <= 0) break
      }
      if (j >= n) throw new XmlError('Unterminated declaration')
      i = j + 1
    } else if (src[i + 1] === '/') {
      const end = src.indexOf('>', i)
      if (end < 0) throw new XmlError('Unterminated end tag')
      const name = src.slice(i + 2, end).trim()
      // Lenient: close up to the matching element.
      let k = stack.length - 1
      while (k > 0 && stack[k].name !== name) k--
      if (k === 0) throw new XmlError(`Unexpected </${name}>`)
      stack.length = k
      i = end + 1
    } else {
      // Start tag: scan to the closing '>' respecting quoted values.
      let j = i + 1
      let quote: string | null = null
      for (; j < n; j++) {
        const c = src[j]
        if (quote) {
          if (c === quote) quote = null
        } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      if (j >= n) throw new XmlError('Unterminated start tag')
      let body = src.slice(i + 1, j)
      const selfClosing = body.endsWith('/')
      if (selfClosing) body = body.slice(0, -1)
      const m = /^([^\s/>]+)/.exec(body)
      if (!m) throw new XmlError('Invalid tag')
      const node: XmlNode = { name: m[1], attrs: {}, children: [], text: '' }
      const attrRe = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g
      let a: RegExpExecArray | null
      const rest = body.slice(m[1].length)
      while ((a = attrRe.exec(rest))) node.attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '')
      top().children.push(node)
      if (!selfClosing) {
        if (stack.length > MAX_DEPTH) throw new XmlError('Too deeply nested')
        stack.push(node)
      }
      i = j + 1
    }
  }
  if (stack.length > 1) throw new XmlError(`Unclosed <${top().name}>`)
  const elements = root.children
  if (elements.length === 0) throw new XmlError('No root element')
  return elements[0]
}
