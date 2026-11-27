import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { fromStream, zipStream } from './zip'

describe('zipStream', () => {
  it('builds a valid ZIP from chunked entries', async () => {
    const big = Array.from({ length: 20_000 }, (_, i) => `línea ${i}\r\n`)
    const stream = zipStream([
      { name: 'LEEME.txt', content: async function* () { yield 'hola' } },
      { name: 'datos.csv', content: async function* () { for (const l of big) yield l } },
      {
        name: 'bytes.csv',
        content: () => fromStream(new Blob(['a,b\r\n', '1,2\r\n']).stream()),
      },
      { name: 'vacio.csv', content: async function* () {} },
    ])
    const zip = new Uint8Array(await new Response(stream).arrayBuffer())
    const files = unzipSync(zip)
    expect(Object.keys(files)).toEqual(['LEEME.txt', 'datos.csv', 'bytes.csv', 'vacio.csv'])
    expect(strFromU8(files['LEEME.txt'])).toBe('hola')
    expect(strFromU8(files['datos.csv'])).toBe(big.join(''))
    expect(strFromU8(files['bytes.csv'])).toBe('a,b\r\n1,2\r\n')
    expect(files['vacio.csv']).toHaveLength(0)
  })

  it('fails the download when a file fails', async () => {
    const stream = zipStream([
      {
        name: 'x.csv',
        content: async function* () {
          yield 'a'
          throw new Error('db down')
        },
      },
    ])
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow()
  })
})
