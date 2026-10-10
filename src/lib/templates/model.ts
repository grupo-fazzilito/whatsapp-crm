// WhatsApp message templates as edited in Whasalia (client-safe, pure).
//
// The editor uses readable named variables — "Hola {{nombre_cliente}}" —
// and each variable has a label, a sample value (Meta requires samples to
// review the template) and an optional data source used to fill it when
// sending (broadcasts, automations). Meta receives positional variables
// ({{1}}, {{2}}…) numbered by order of first appearance, which is what the
// existing senders already fill.

export type TemplateCategory = 'Marketing' | 'Utility' | 'Authentication'
export type HeaderType = 'none' | 'text' | 'image' | 'video' | 'document'
export type ButtonType = 'quick_reply' | 'url' | 'phone'

/** Where a variable's value comes from when the template is sent. */
export type VariableSource = 'contact.name' | 'contact.phone' | 'contact.email' | 'contact.company' | 'workspace.name' | 'manual'

export interface TemplateVariable {
  /** Name used in the text: {{key}} (a-z, 0-9, _). */
  key: string
  /** Human label shown in the editor and when sending. */
  label: string
  /** Sample value sent to Meta for review and used in the preview. */
  example: string
  source: VariableSource
  /** Position on Meta's side ({{1}}…), set by toMetaPayload / fromMeta. */
  index?: number
}

export interface TemplateButton {
  type: ButtonType
  text: string
  /** url: may end with {{1}} (dynamic suffix); phone: E.164 number. */
  value?: string
  /** Sample for a dynamic URL suffix. */
  example?: string
}

export interface TemplateDraft {
  /** Meta name: lowercase a-z, 0-9 and _ (generated from the title). */
  name: string
  category: TemplateCategory
  language: string
  header: { type: HeaderType; text?: string; mediaUrl?: string }
  body: string
  footer?: string
  buttons: TemplateButton[]
  variables: TemplateVariable[]
  /** Authentication templates: minutes the code is valid (shown in the footer). */
  codeExpiration?: number
}

export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'es', label: 'Español' },
  { code: 'es_PE', label: 'Español (Perú)' },
  { code: 'es_MX', label: 'Español (México)' },
  { code: 'es_AR', label: 'Español (Argentina)' },
  { code: 'es_ES', label: 'Español (España)' },
  { code: 'en', label: 'English' },
  { code: 'en_US', label: 'English (US)' },
  { code: 'en_GB', label: 'English (UK)' },
  { code: 'pt_BR', label: 'Português (Brasil)' },
]

/** Ready-made variables offered by the "Insertar variable" menu. */
export const VARIABLE_PRESETS: { key: string; label: { es: string; en: string }; example: { es: string; en: string }; source: VariableSource }[] = [
  { key: 'nombre_cliente', label: { es: 'Nombre del cliente', en: 'Customer name' }, example: { es: 'María', en: 'Mary' }, source: 'contact.name' },
  { key: 'nombre_negocio', label: { es: 'Nombre del negocio', en: 'Business name' }, example: { es: 'Mi Negocio', en: 'My Business' }, source: 'workspace.name' },
  { key: 'numero_pedido', label: { es: 'Número de pedido', en: 'Order number' }, example: { es: '#1024', en: '#1024' }, source: 'manual' },
  { key: 'fecha', label: { es: 'Fecha', en: 'Date' }, example: { es: '15 de octubre', en: 'October 15' }, source: 'manual' },
  { key: 'hora', label: { es: 'Hora', en: 'Time' }, example: { es: '10:30 a. m.', en: '10:30 AM' }, source: 'manual' },
  { key: 'monto', label: { es: 'Monto', en: 'Amount' }, example: { es: 'S/ 120.00', en: '$120.00' }, source: 'manual' },
  { key: 'enlace', label: { es: 'Enlace', en: 'Link' }, example: { es: 'https://tu-sitio.com/p/123', en: 'https://your-site.com/p/123' }, source: 'manual' },
  { key: 'empresa_cliente', label: { es: 'Empresa del cliente', en: 'Customer company' }, example: { es: 'Acme SAC', en: 'Acme Inc' }, source: 'contact.company' },
]

export const LIMITS = { name: 512, headerText: 60, body: 1024, footer: 60, buttonText: 25, buttons: 10, url: 2000 }

/** "Confirmación de pedido" → "confirmacion_de_pedido" (Meta's allowed name). */
export function slugifyName(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, LIMITS.name)
}

/** "Número de pedido" → "numero_de_pedido" (variable key). */
export const variableKey = (label: string) => slugifyName(label).slice(0, 40) || 'variable'

const VAR_RE = /\{\{\s*([a-z0-9_]+)\s*\}\}/gi

/** Variable keys in order of first appearance. */
export function variablesIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(VAR_RE)) {
    const k = m[1].toLowerCase()
    if (!out.includes(k)) out.push(k)
  }
  return out
}

/** Replaces {{key}} with the value from `values` (missing → left as is). */
export function fillVariables(text: string, values: Record<string, string>): string {
  return text.replace(VAR_RE, (all, k: string) => values[k.toLowerCase()] ?? all)
}

/** Splits text into plain parts and variable parts (for highlighting). */
export function splitVariables(text: string): { text: string; variable?: string }[] {
  const parts: { text: string; variable?: string }[] = []
  let last = 0
  for (const m of text.matchAll(VAR_RE)) {
    if (m.index! > last) parts.push({ text: text.slice(last, m.index) })
    parts.push({ text: m[0], variable: m[1].toLowerCase() })
    last = m.index! + m[0].length
  }
  if (last < text.length) parts.push({ text: text.slice(last) })
  return parts
}

export interface ValidationIssue {
  field: 'name' | 'body' | 'header' | 'footer' | 'buttons' | 'variables' | 'language'
  code: string
  detail?: string
}

/** Meta's review rules we can check before submitting. */
export function validateDraft(d: TemplateDraft): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!/^[a-z0-9_]{1,512}$/.test(d.name)) issues.push({ field: 'name', code: 'name_format' })
  if (!d.language) issues.push({ field: 'language', code: 'language_required' })
  if (d.category === 'Authentication') return issues // Meta writes the text of authentication templates.

  const body = d.body.trim()
  if (!body) issues.push({ field: 'body', code: 'body_required' })
  if (body.length > LIMITS.body) issues.push({ field: 'body', code: 'body_too_long' })
  const used = variablesIn(body)
  // Meta rejects a body that starts or ends with a variable.
  if (/^\{\{/.test(body) || /\}\}$/.test(body)) issues.push({ field: 'body', code: 'variable_at_edge' })
  // …and bodies with more variables than words around them.
  const words = body.replace(VAR_RE, ' ').split(/\s+/).filter(Boolean).length
  if (used.length && words < used.length * 2) issues.push({ field: 'body', code: 'too_many_variables' })
  for (const k of used) {
    const v = d.variables.find((x) => x.key === k)
    if (!v) issues.push({ field: 'variables', code: 'variable_undefined', detail: k })
    else if (!v.example.trim()) issues.push({ field: 'variables', code: 'example_required', detail: k })
  }
  if (d.header.type === 'text') {
    const h = (d.header.text ?? '').trim()
    if (!h) issues.push({ field: 'header', code: 'header_required' })
    if (h.length > LIMITS.headerText) issues.push({ field: 'header', code: 'header_too_long' })
    if (variablesIn(h).length > 1) issues.push({ field: 'header', code: 'header_one_variable' })
    for (const k of variablesIn(h)) if (!d.variables.find((x) => x.key === k)?.example.trim()) issues.push({ field: 'variables', code: 'example_required', detail: k })
  }
  if (['image', 'video', 'document'].includes(d.header.type) && !d.header.mediaUrl) issues.push({ field: 'header', code: 'media_required' })
  if ((d.footer ?? '').length > LIMITS.footer) issues.push({ field: 'footer', code: 'footer_too_long' })
  if (variablesIn(d.footer ?? '').length) issues.push({ field: 'footer', code: 'footer_no_variables' })
  if (d.buttons.length > LIMITS.buttons) issues.push({ field: 'buttons', code: 'too_many_buttons' })
  if (d.buttons.filter((b) => b.type === 'url').length > 2) issues.push({ field: 'buttons', code: 'too_many_url_buttons' })
  if (d.buttons.filter((b) => b.type === 'phone').length > 1) issues.push({ field: 'buttons', code: 'too_many_phone_buttons' })
  for (const b of d.buttons) {
    if (!b.text.trim() || b.text.length > LIMITS.buttonText) issues.push({ field: 'buttons', code: 'button_text', detail: b.text })
    if (b.type === 'url') {
      if (!/^https?:\/\/\S+$/.test(b.value ?? '')) issues.push({ field: 'buttons', code: 'button_url', detail: b.text })
      if (/\{\{1\}\}$/.test(b.value ?? '') && !b.example?.trim()) issues.push({ field: 'buttons', code: 'button_url_example', detail: b.text })
    }
    if (b.type === 'phone' && !/^\+?[1-9]\d{6,14}$/.test((b.value ?? '').replace(/[\s-]/g, ''))) issues.push({ field: 'buttons', code: 'button_phone', detail: b.text })
  }
  return issues
}

/** Text with named variables → Meta's positional text, given the order. */
function positional(text: string, order: string[]): string {
  return text.replace(VAR_RE, (_all, k: string) => `{{${order.indexOf(k.toLowerCase()) + 1}}}`)
}

/**
 * Draft → Graph API body for POST /{waba-id}/message_templates. `headerHandle`
 * is the upload handle of the header sample (image/video/document).
 * Returns the variables with their Meta positions (body and header are
 * numbered separately, as Meta does).
 */
export function toMetaPayload(d: TemplateDraft, headerHandle?: string): { payload: Record<string, unknown>; variables: TemplateVariable[] } {
  const category = d.category.toUpperCase()
  if (d.category === 'Authentication') {
    return {
      payload: {
        name: d.name,
        language: d.language,
        category,
        components: [
          { type: 'BODY', add_security_recommendation: true },
          { type: 'FOOTER', code_expiration_minutes: d.codeExpiration ?? 10 },
          { type: 'BUTTONS', buttons: [{ type: 'OTP', otp_type: 'COPY_CODE' }] },
        ],
      },
      variables: [],
    }
  }
  const byKey = new Map(d.variables.map((v) => [v.key, v]))
  const bodyOrder = variablesIn(d.body)
  const headerOrder = d.header.type === 'text' ? variablesIn(d.header.text ?? '') : []
  const components: Record<string, unknown>[] = []

  if (d.header.type === 'text') {
    components.push({
      type: 'HEADER',
      format: 'TEXT',
      text: positional(d.header.text ?? '', headerOrder),
      ...(headerOrder.length ? { example: { header_text: headerOrder.map((k) => byKey.get(k)?.example ?? '') } } : {}),
    })
  } else if (d.header.type !== 'none') {
    components.push({ type: 'HEADER', format: d.header.type.toUpperCase(), ...(headerHandle ? { example: { header_handle: [headerHandle] } } : {}) })
  }
  components.push({
    type: 'BODY',
    text: positional(d.body.trim(), bodyOrder),
    ...(bodyOrder.length ? { example: { body_text: [bodyOrder.map((k) => byKey.get(k)?.example ?? '')] } } : {}),
  })
  if (d.footer?.trim()) components.push({ type: 'FOOTER', text: d.footer.trim() })
  if (d.buttons.length) {
    components.push({
      type: 'BUTTONS',
      buttons: d.buttons.map((b) =>
        b.type === 'quick_reply'
          ? { type: 'QUICK_REPLY', text: b.text }
          : b.type === 'url'
            ? { type: 'URL', text: b.text, url: b.value, ...(/\{\{1\}\}$/.test(b.value ?? '') ? { example: [(b.value ?? '').replace('{{1}}', b.example ?? '')] } : {}) }
            : { type: 'PHONE_NUMBER', text: b.text, phone_number: (b.value ?? '').replace(/[\s-]/g, '') },
      ),
    })
  }
  const variables = [
    ...bodyOrder.map((k, i) => ({ ...(byKey.get(k) ?? { key: k, label: k, example: '', source: 'manual' as const }), index: i + 1 })),
    ...headerOrder.filter((k) => !bodyOrder.includes(k)).map((k) => ({ ...(byKey.get(k) ?? { key: k, label: k, example: '', source: 'manual' as const }) })),
  ]
  return { payload: { name: d.name, language: d.language, category, allow_category_change: true, components }, variables }
}

/**
 * Named texts → Meta's positional texts ({{1}}…) as stored in the database,
 * with the variables in use (body ones carry their position in `index`;
 * a header variable has no index — the header has its own {{1}}).
 */
export function toPositional(d: TemplateDraft): { body: string; header: string; variables: TemplateVariable[] } {
  const byKey = new Map(d.variables.map((v) => [v.key, v]))
  const bodyOrder = variablesIn(d.body)
  const headerOrder = d.header.type === 'text' ? variablesIn(d.header.text ?? '') : []
  const blank = (key: string): TemplateVariable => ({ key, label: key, example: '', source: 'manual' })
  return {
    body: positional(d.body.trim(), bodyOrder),
    header: d.header.type === 'text' ? positional((d.header.text ?? '').trim(), headerOrder) : '',
    variables: [
      ...bodyOrder.map((k, i) => ({ ...(byKey.get(k) ?? blank(k)), index: i + 1 })),
      ...headerOrder.filter((k) => !bodyOrder.includes(k)).map((k) => ({ ...(byKey.get(k) ?? blank(k)), index: undefined })),
    ],
  }
}

/** Meta's positional body ({{1}}) → named text, using saved variables when present. */
export function namedFromPositional(text: string, variables: TemplateVariable[]): string {
  return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_all, n: string) => `{{${variables.find((v) => v.index === Number(n))?.key ?? `variable_${n}`}}}`)
}

export interface TemplateSuggestion {
  id: string
  category: TemplateCategory
  title: { es: string; en: string }
  body: { es: string; en: string }
  footer?: { es: string; en: string }
  buttons?: { type: ButtonType; text: { es: string; en: string } }[]
  /** Preset keys used in the body. */
  variables: string[]
}

/** Starting points offered in the editor ("Usar una plantilla sugerida"). */
export const TEMPLATE_SUGGESTIONS: TemplateSuggestion[] = [
  {
    id: 'appointment_reminder',
    category: 'Utility',
    title: { es: 'Recordatorio de cita', en: 'Appointment reminder' },
    body: {
      es: 'Hola {{nombre_cliente}}, te recordamos tu cita el {{fecha}} a las {{hora}} en {{nombre_negocio}}. Responde a este mensaje si necesitas cambiarla.',
      en: 'Hi {{nombre_cliente}}, this is a reminder of your appointment on {{fecha}} at {{hora}} at {{nombre_negocio}}. Reply to this message if you need to change it.',
    },
    buttons: [
      { type: 'quick_reply', text: { es: 'Confirmar', en: 'Confirm' } },
      { type: 'quick_reply', text: { es: 'Reprogramar', en: 'Reschedule' } },
    ],
    variables: ['nombre_cliente', 'fecha', 'hora', 'nombre_negocio'],
  },
  {
    id: 'order_confirmation',
    category: 'Utility',
    title: { es: 'Confirmación de pedido', en: 'Order confirmation' },
    body: {
      es: 'Hola {{nombre_cliente}}, recibimos tu pedido {{numero_pedido}} por {{monto}}. Te avisaremos cuando esté en camino. ¡Gracias por tu compra!',
      en: 'Hi {{nombre_cliente}}, we received your order {{numero_pedido}} for {{monto}}. We will let you know when it is on its way. Thank you for your purchase!',
    },
    variables: ['nombre_cliente', 'numero_pedido', 'monto'],
  },
  {
    id: 'order_shipped',
    category: 'Utility',
    title: { es: 'Pedido en camino', en: 'Order on its way' },
    body: {
      es: 'Hola {{nombre_cliente}}, tu pedido {{numero_pedido}} ya está en camino. Puedes seguirlo aquí: {{enlace}} ¡Gracias por tu compra!',
      en: 'Hi {{nombre_cliente}}, your order {{numero_pedido}} is on its way. Track it here: {{enlace}} Thank you for your purchase!',
    },
    variables: ['nombre_cliente', 'numero_pedido', 'enlace'],
  },
  {
    id: 'welcome',
    category: 'Marketing',
    title: { es: 'Bienvenida', en: 'Welcome' },
    body: {
      es: '¡Hola {{nombre_cliente}}! Gracias por escribir a {{nombre_negocio}}. Por aquí te enviaremos novedades y promociones exclusivas.',
      en: 'Hi {{nombre_cliente}}! Thanks for contacting {{nombre_negocio}}. We will send you news and exclusive offers here.',
    },
    footer: { es: 'Responde STOP para no recibir más mensajes', en: 'Reply STOP to unsubscribe' },
    variables: ['nombre_cliente', 'nombre_negocio'],
  },
  {
    id: 'promotion',
    category: 'Marketing',
    title: { es: 'Promoción', en: 'Promotion' },
    body: {
      es: 'Hola {{nombre_cliente}}, ¡tenemos una oferta para ti! Este mes tienes un descuento especial en {{nombre_negocio}}. Escríbenos para aprovecharlo.',
      en: 'Hi {{nombre_cliente}}, we have an offer for you! This month you get a special discount at {{nombre_negocio}}. Message us to claim it.',
    },
    footer: { es: 'Responde STOP para no recibir más mensajes', en: 'Reply STOP to unsubscribe' },
    buttons: [{ type: 'quick_reply', text: { es: 'Quiero la oferta', en: 'I want the offer' } }],
    variables: ['nombre_cliente', 'nombre_negocio'],
  },
  {
    id: 'reactivation',
    category: 'Marketing',
    title: { es: 'Te extrañamos', en: 'We miss you' },
    body: {
      es: 'Hola {{nombre_cliente}}, hace tiempo no sabemos de ti. ¿Te ayudamos con algo? En {{nombre_negocio}} estamos para atenderte.',
      en: 'Hi {{nombre_cliente}}, it has been a while. Can we help you with anything? We are here for you at {{nombre_negocio}}.',
    },
    variables: ['nombre_cliente', 'nombre_negocio'],
  },
  {
    id: 'feedback',
    category: 'Utility',
    title: { es: 'Encuesta de satisfacción', en: 'Feedback survey' },
    body: {
      es: 'Hola {{nombre_cliente}}, gracias por tu visita a {{nombre_negocio}}. ¿Cómo calificarías la atención que recibiste?',
      en: 'Hi {{nombre_cliente}}, thanks for visiting {{nombre_negocio}}. How would you rate the service you received?',
    },
    buttons: [
      { type: 'quick_reply', text: { es: 'Excelente', en: 'Excellent' } },
      { type: 'quick_reply', text: { es: 'Buena', en: 'Good' } },
      { type: 'quick_reply', text: { es: 'Puede mejorar', en: 'Could be better' } },
    ],
    variables: ['nombre_cliente', 'nombre_negocio'],
  },
  {
    id: 'verification_code',
    category: 'Authentication',
    title: { es: 'Código de verificación', en: 'Verification code' },
    body: { es: '', en: '' },
    variables: [],
  },
]

/** Builds an editor draft from a suggestion in the UI language. */
export function draftFromSuggestion(s: TemplateSuggestion, locale: 'es' | 'en', language: string): TemplateDraft {
  return {
    name: slugifyName(s.title[locale]),
    category: s.category,
    language,
    header: { type: 'none' },
    body: s.body[locale],
    footer: s.footer?.[locale] ?? '',
    buttons: (s.buttons ?? []).map((b) => ({ type: b.type, text: b.text[locale] })),
    variables: s.variables.map((k) => {
      const p = VARIABLE_PRESETS.find((x) => x.key === k)!
      return { key: k, label: p.label[locale], example: p.example[locale], source: p.source }
    }),
    codeExpiration: s.category === 'Authentication' ? 10 : undefined,
  }
}

// ── Editor / list helpers (client-safe) ─────────────────────────────────────

export type TemplateStatus = 'Draft' | 'Pending' | 'Approved' | 'Rejected'

/** A template as GET /api/whatsapp/templates returns it. */
export interface TemplateRow {
  id: string
  name: string
  category: TemplateCategory
  language: string
  header_type: Exclude<HeaderType, 'none'> | null
  header_content: string | null
  header_media_url: string | null
  /** Meta's positional form, e.g. "Hola {{1}}" (use `draft` for the named form). */
  body_text: string
  footer_text: string | null
  buttons: TemplateButton[] | null
  variables: TemplateVariable[]
  status: TemplateStatus
  rejection_reason: string | null
  meta_template_id: string | null
  channel_id: string | null
  submitted_at: string | null
  updated_at: string
  /** Editor-ready version with named variables. */
  draft?: TemplateDraft
}

/** Empty editor draft. */
export function emptyDraft(language: string): TemplateDraft {
  return { name: '', category: 'Utility', language, header: { type: 'none' }, body: '', footer: '', buttons: [], variables: [] }
}

/** Saved row → editor draft (the server's `draft` when present). */
export function draftFromRow(r: TemplateRow): TemplateDraft {
  if (r.draft) return { ...r.draft, footer: r.draft.footer ?? '', buttons: r.draft.buttons ?? [], variables: r.draft.variables ?? [] }
  const headerType: HeaderType = r.header_type ?? 'none'
  return {
    name: r.name,
    category: r.category,
    language: r.language,
    header: { type: headerType, text: headerType === 'text' ? (r.header_content ?? '') : undefined, mediaUrl: r.header_media_url ?? undefined },
    body: namedFromPositional(r.body_text ?? '', Array.isArray(r.variables) ? r.variables : []),
    footer: r.footer_text ?? '',
    buttons: Array.isArray(r.buttons) ? r.buttons : [],
    variables: Array.isArray(r.variables) ? r.variables : [],
  }
}

/** Variable keys used in the header (text headers) and the body, header first. */
export function draftVariableKeys(d: Pick<TemplateDraft, 'header' | 'body'>): string[] {
  const keys = d.header.type === 'text' ? variablesIn(d.header.text ?? '') : []
  for (const k of variablesIn(d.body)) if (!keys.includes(k)) keys.push(k)
  return keys
}

/** Default definition of a variable key: the preset when there is one. */
export function defaultVariable(key: string, locale: 'es' | 'en'): TemplateVariable {
  const p = VARIABLE_PRESETS.find((x) => x.key === key)
  return p
    ? { key, label: p.label[locale], example: p.example[locale], source: p.source }
    : { key, label: key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), example: '', source: 'manual' }
}

/** Human title from a Meta name: "confirmacion_de_pedido" → "Confirmacion de pedido". */
export const titleFromName = (name: string) => name.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/**
 * Text Meta writes for authentication templates, in the template language
 * (what the customer sees). `{code}` is the one-time code.
 */
export function authenticationText(language: string, minutes?: number): { body: string; footer?: string; button: string } {
  const lang = language.slice(0, 2)
  const m = minutes ?? 10
  if (lang === 'en') return { body: '*{code}* is your verification code. For your security, do not share this code.', footer: `This code expires in ${m} minutes.`, button: 'Copy code' }
  if (lang === 'pt') return { body: '*{code}* é seu código de verificação. Para sua segurança, não o compartilhe.', footer: `Este código expira em ${m} minutos.`, button: 'Copiar código' }
  return { body: '*{code}* es tu código de verificación. Por tu seguridad, no lo compartas.', footer: `Este código caduca en ${m} minutos.`, button: 'Copiar código' }
}

/** Our own submission error codes (meta.ts); anything else is Meta's text. */
export const SUBMIT_ERROR_CODES = ['whatsapp_not_connected', 'waba_missing', 'app_id_missing', 'media_not_found', 'media_upload_failed'] as const

/** i18n key for a known submission error code, or null for Meta's own message. */
export function submitErrorKey(error: string | undefined | null): string | null {
  return error && (SUBMIT_ERROR_CODES as readonly string[]).includes(error) ? `templates.errors.${error}` : null
}
