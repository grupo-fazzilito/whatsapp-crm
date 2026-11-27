import { Zip, ZipDeflate } from 'fflate'

// A ZIP built while it downloads: each file's content comes in chunks
// (an async iterable) and is compressed and sent on, one file after the
// other, so nothing waits for the whole archive in memory. Pulled by the
// reader, so a slow download also slows the database reads.

export interface ZipEntry {
  name: string
  content: () => AsyncIterable<Uint8Array | string>
}

const FLUSH_AT = 64 * 1024

async function* zipChunks(entries: ZipEntry[], mtime: Date): AsyncGenerator<Uint8Array> {
  const enc = new TextEncoder()
  const out: Uint8Array[] = []
  let failure: Error | null = null
  const zip = new Zip((err, data) => {
    if (err) failure = err
    else out.push(data)
  })
  const drain = function* () {
    if (failure) throw failure
    while (out.length) yield out.shift()!
  }
  for (const e of entries) {
    const file = new ZipDeflate(e.name, { level: 6 })
    file.mtime = mtime
    zip.add(file)
    // fflate compresses every push as its own block: gather small pieces
    // (one CSV line each) into ~64 KB before pushing.
    let pending: Uint8Array[] = []
    let size = 0
    const flush = (final: boolean) => {
      const buf = new Uint8Array(size)
      let at = 0
      for (const p of pending) {
        buf.set(p, at)
        at += p.length
      }
      pending = []
      size = 0
      file.push(buf, final)
    }
    for await (const chunk of e.content()) {
      const bytes = typeof chunk === 'string' ? enc.encode(chunk) : chunk
      pending.push(bytes)
      size += bytes.length
      if (size >= FLUSH_AT) {
        flush(false)
        yield* drain()
      }
    }
    flush(true)
    yield* drain()
  }
  zip.end()
  yield* drain()
}

export function zipStream(entries: ZipEntry[], mtime = new Date()): ReadableStream<Uint8Array> {
  const it = zipChunks(entries, mtime)
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next()
        if (done) controller.close()
        else controller.enqueue(value)
      } catch (err) {
        console.error('[backup] zip failed:', err instanceof Error ? err.message : err)
        controller.error(err)
      }
    },
    async cancel() {
      await it.return(undefined)
    },
  })
}

/** Reads a ReadableStream as an async iterable (works where the stream isn't one natively). */
export async function* fromStream(stream: ReadableStream<Uint8Array>): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      yield value
    }
  } finally {
    reader.releaseLock()
  }
}
