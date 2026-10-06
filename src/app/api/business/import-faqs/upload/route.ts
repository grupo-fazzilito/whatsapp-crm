import { NextResponse } from 'next/server'
import mammoth from 'mammoth'
import * as XLSX from 'xlsx'
import { requireWorkspace } from '@/lib/workspace/context'
import { FAQS_SCHEMA, MAX_TEXT, extract, faqsPrompt, importError, normalizeFaqs } from '@/lib/business/importer'

const MAX_FILE_SIZE = 8 * 1024 * 1024 // 8 MB

async function fileToText(file: File, name: string, mime: string): Promise<string | null> {
  if (name.endsWith('.docx') || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(await file.arrayBuffer()) })
    return value
  }
  if (
    name.endsWith('.xlsx') ||
    name.endsWith('.xls') ||
    mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    mime === 'application/vnd.ms-excel'
  ) {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'buffer' })
    return wb.SheetNames.map((s) => `[Sheet: ${s}]\n${XLSX.utils.sheet_to_csv(wb.Sheets[s])}`).join('\n\n')
  }
  if (name.endsWith('.txt') || name.endsWith('.csv') || mime.startsWith('text/')) return file.text()
  return null
}

/** POST multipart { file } → { faqs: ImportedFaq[], fileName } (preview, nothing saved). */
export async function POST(request: Request) {
  const guard = await requireWorkspace('admin')
  if (!guard.ok) return guard.response
  const ws = guard.ctx.workspace

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 })
  }
  const file = form.get('file')
  if (!(file instanceof File) || !file.name) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ error: 'The uploaded file is empty' }, { status: 400 })
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File exceeds the 8 MB limit' }, { status: 400 })

  const name = file.name.toLowerCase()
  const mime = file.type
  const system = faqsPrompt(ws)

  try {
    if (name.endsWith('.pdf') || mime === 'application/pdf') {
      return NextResponse.json(
        { error: 'PDF files are not supported. Upload Word, Excel or text, or paste the content as text.' },
        { status: 400 },
      )
    }
    const text = await fileToText(file, name, mime)
    if (text === null) {
      return NextResponse.json(
        { error: 'Unsupported file type. Upload Word (.docx), Excel (.xlsx / .xls) or text (.txt / .csv).' },
        { status: 400 },
      )
    }
    if (!text.trim()) return NextResponse.json({ error: 'Could not extract any text from the file' }, { status: 400 })
    const raw = await extract(system, text.slice(0, MAX_TEXT), FAQS_SCHEMA, 'faqs')
    return NextResponse.json({ faqs: normalizeFaqs(raw), fileName: file.name })
  } catch (err) {
    return importError(err)
  }
}
