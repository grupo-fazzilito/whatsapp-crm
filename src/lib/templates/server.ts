import 'server-only'
import { defaultChannel, loadChannel } from '@/lib/channels/store'
import { isUuid } from '@/lib/workspace/constants'
import type { TenantDb } from '@/lib/db/tenant'
import { isPrismaError } from '@/lib/db/errors'
import { normalizeRaw } from '@/lib/db/compat'
import { LANGUAGES, LIMITS, namedFromPositional, toPositional, validateDraft, type ButtonType, type HeaderType, type TemplateCategory, type TemplateDraft, type TemplateVariable, type ValidationIssue, type VariableSource } from './model'
import { MetaTemplateError, editTemplate, submitTemplate } from './meta'

// Save / submit flow shared by the template API routes.

const CATEGORIES: TemplateCategory[] = ['Marketing', 'Utility', 'Authentication']
const HEADERS: HeaderType[] = ['none', 'text', 'image', 'video', 'document']
const BUTTONS: ButtonType[] = ['quick_reply', 'url', 'phone']
const SOURCES: VariableSource[] = ['contact.name', 'contact.phone', 'contact.email', 'contact.company', 'workspace.name', 'manual']

const s = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** Untrusted JSON → a well-typed draft (lengths clamped; validation is separate). */
export function parseDraft(input: unknown): TemplateDraft | null {
  if (!input || typeof input !== 'object') return null
  const d = input as Record<string, unknown>
  const header = (d.header ?? {}) as Record<string, unknown>
  const category = CATEGORIES.includes(d.category as TemplateCategory) ? (d.category as TemplateCategory) : 'Marketing'
  const language = typeof d.language === 'string' && /^[a-z]{2,3}(_[A-Z]{2})?$/.test(d.language) ? d.language : LANGUAGES[0].code
  return {
    name: s(d.name, LIMITS.name).trim(),
    category,
    language,
    header: {
      type: HEADERS.includes(header.type as HeaderType) ? (header.type as HeaderType) : 'none',
      text: s(header.text, 200),
      mediaUrl: s(header.mediaUrl, 2000) || undefined,
    },
    body: s(d.body, LIMITS.body + 200),
    footer: s(d.footer, 200),
    buttons: (Array.isArray(d.buttons) ? d.buttons : []).slice(0, 12).map((b) => {
      const x = (b ?? {}) as Record<string, unknown>
      return { type: BUTTONS.includes(x.type as ButtonType) ? (x.type as ButtonType) : 'quick_reply', text: s(x.text, 60), value: s(x.value, LIMITS.url) || undefined, example: s(x.example, 500) || undefined }
    }),
    variables: (Array.isArray(d.variables) ? d.variables : []).slice(0, 40).flatMap((v) => {
      const x = (v ?? {}) as Record<string, unknown>
      const key = s(x.key, 40).toLowerCase()
      if (!/^[a-z0-9_]+$/.test(key)) return []
      return [{ key, label: s(x.label, 80) || key, example: s(x.example, 500), source: SOURCES.includes(x.source as VariableSource) ? (x.source as VariableSource) : 'manual' }]
    }),
    codeExpiration: typeof d.codeExpiration === 'number' ? Math.min(90, Math.max(1, Math.round(d.codeExpiration))) : undefined,
  }
}

/**
 * Columns written for a draft. Texts are stored in Meta's positional form
 * ({{1}}) — what broadcasts, the inbox and the public API fill — and the
 * named variables keep their position in `variables[].index`.
 */
function columns(draft: TemplateDraft) {
  const { body, header, variables } = toPositional(draft)
  return {
    name: draft.name,
    category: draft.category,
    language: draft.language,
    header_type: draft.header.type === 'none' ? null : draft.header.type,
    header_content: draft.header.type === 'text' ? header || null : null,
    header_media_url: ['image', 'video', 'document'].includes(draft.header.type) ? draft.header.mediaUrl ?? null : null,
    body_text: body,
    footer_text: draft.footer?.trim() || null,
    buttons: draft.buttons as unknown as object,
    variables: variables as unknown as object,
  }
}

/** Stored row → editor draft (named variables). */
export function draftFromRow(row: Record<string, unknown>): TemplateDraft {
  const variables = (Array.isArray(row.variables) ? row.variables : []) as TemplateVariable[]
  const bodyVars = variables.filter((v) => typeof v.index === 'number')
  const headerVar = variables.find((v) => v.index === undefined)
  return parseDraft({
    name: row.name,
    category: row.category,
    language: row.language,
    header: {
      type: row.header_type ?? 'none',
      text: typeof row.header_content === 'string' ? row.header_content.replace(/\{\{\s*1\s*\}\}/g, `{{${headerVar?.key ?? 'variable_encabezado'}}}`) : '',
      mediaUrl: row.header_media_url ?? undefined,
    },
    body: namedFromPositional(String(row.body_text ?? ''), bodyVars),
    footer: row.footer_text ?? '',
    buttons: Array.isArray(row.buttons) ? row.buttons : [],
    variables: variables.length ? variables : [...String(row.body_text ?? '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => ({ key: `variable_${m[1]}`, label: `Variable ${m[1]}`, example: '', source: 'manual' })),
  })!
}

/** API shape of a stored template: the row plus its editor draft. */
export function templateView(row: Record<string, unknown>) {
  const r = normalizeRaw([row])[0] as Record<string, unknown>
  return { ...r, draft: draftFromRow(r) }
}

export type SaveResult =
  | { ok: true; template: Record<string, unknown>; submitted: boolean; error?: string }
  | { ok: false; status: number; body: Record<string, unknown> }

/**
 * Creates (no id) or updates a template; with `submit`, sends it to Meta
 * (new → create, already submitted → edit). A failed submission keeps the
 * row as it was saved and returns Meta's message in `error`.
 */
export async function saveTemplate(opts: {
  db: TenantDb
  workspaceId: string
  userId: string
  draft: TemplateDraft
  id?: string
  channelId?: string | null
  submit: boolean
}): Promise<SaveResult> {
  const { db, workspaceId, draft } = opts
  const issues: ValidationIssue[] = validateDraft(draft)
  if (issues.length) return { ok: false, status: 422, body: { error: 'invalid', issues } }

  const existing = opts.id ? await db.message_templates.findFirst({ where: { id: opts.id } }) : null
  if (opts.id && !existing) return { ok: false, status: 404, body: { error: 'not_found' } }
  if (existing && existing.status === 'Pending') return { ok: false, status: 409, body: { error: 'in_review' } }

  const channelId = opts.channelId && isUuid(opts.channelId) ? opts.channelId : existing?.channel_id ?? null
  const channel = channelId ? await loadChannel(workspaceId, channelId) : await defaultChannel(workspaceId, 'whatsapp')

  let row: Record<string, unknown>
  try {
    const data = { ...columns(draft), channel_id: channel?.id ?? null, updated_at: new Date() }
    row = existing
      ? (await db.message_templates.updateManyAndReturn({ where: { id: existing.id }, data }))[0]
      : await db.message_templates.create({ data: { ...data, workspace_id: workspaceId, user_id: opts.userId, status: 'Draft' } })
  } catch (err) {
    if (isPrismaError(err, 'P2002')) return { ok: false, status: 409, body: { error: 'name_taken' } }
    throw err
  }
  if (!opts.submit) return { ok: true, template: templateView(row), submitted: false }

  if (!channel) return { ok: true, template: templateView(row), submitted: false, error: 'whatsapp_not_connected' }
  try {
    const metaId = (row.meta_template_id as string | null) ?? null
    let update: Record<string, unknown>
    if (metaId) {
      await editTemplate(channel, metaId, draft)
      update = { status: 'Pending', rejection_reason: null, submitted_at: new Date() }
    } else {
      const out = await submitTemplate(channel, draft)
      update = {
        meta_template_id: out.id,
        status: out.status,
        rejection_reason: null,
        submitted_at: new Date(),
        ...(out.category ? { category: out.category.charAt(0) + out.category.slice(1).toLowerCase() } : {}),
      }
    }
    const [saved] = await db.message_templates.updateManyAndReturn({ where: { id: row.id as string }, data: { ...update, updated_at: new Date() } })
    return { ok: true, template: templateView(saved), submitted: true }
  } catch (err) {
    const message = err instanceof MetaTemplateError || err instanceof Error ? err.message : String(err)
    console.error('[templates] submit failed:', message)
    return { ok: true, template: templateView(row), submitted: false, error: message }
  }
}
