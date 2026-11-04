import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { saveTemplate } from '@/lib/templates/server'
import type { TemplateDraft } from '@/lib/templates/model'
import { siteUrl } from '@/lib/real-estate/listing/url'

// The WhatsApp template used to tell a waiting customer that the product is
// back when their 24 h reply window is closed ("Notificar llegada de stock").
// Whasalia leaves it ready as a draft the first time someone joins a
// waitlist; the business only sends it to Meta (Lista de espera or
// Settings → Templates), where it shows like any other template.

/** Meta name per language (the templates list shows it as "Notificar llegada de stock"). */
export const WAITLIST_TEMPLATE_NAMES = { es: 'notificar_llegada_de_stock', en: 'notify_stock_arrival' } as const

type Lang = 'es' | 'en'

/** The button opens `<site>/tienda/<suffix>`; the suffix is `<slug>/producto/<id>`. */
export const waitlistUrlSuffix = (slug: string, productId: string) => `${encodeURIComponent(slug)}/producto/${productId}`

export function waitlistTemplateDraft(lang: Lang, exampleSlug: string): TemplateDraft {
  const es = lang === 'es'
  return {
    name: WAITLIST_TEMPLATE_NAMES[lang],
    category: 'Utility',
    language: lang,
    header: { type: 'none' },
    body: es
      ? 'Hola {{nombre_cliente}}, ¡buenas noticias! Ya tenemos stock de {{producto}} en {{nombre_negocio}}, como nos pediste. Toca el botón para verlo.'
      : 'Hi {{nombre_cliente}}, good news! {{producto}} is back in stock at {{nombre_negocio}}, as you asked. Tap the button to see it.',
    footer: '',
    buttons: [{ type: 'url', text: es ? 'Ver producto' : 'See product', value: `${siteUrl()}/tienda/{{1}}`, example: `${exampleSlug}/producto/1` }],
    variables: [
      { key: 'nombre_cliente', label: es ? 'Nombre del cliente' : 'Customer name', example: 'Ana', source: 'contact.name' },
      { key: 'producto', label: es ? 'Producto' : 'Product', example: es ? 'Polo azul (Talla M)' : 'Blue shirt (Size M)', source: 'manual' },
      { key: 'nombre_negocio', label: es ? 'Negocio' : 'Business', example: es ? 'Tienda Demo' : 'Demo Store', source: 'workspace.name' },
    ],
  }
}

/** Body parameters ({{1}}…{{3}}) and the button's URL suffix. */
export function waitlistTemplateComponents(v: { name: string; item: string; business: string; suffix: string }, lang: Lang) {
  const name = v.name || (lang === 'es' ? 'cliente' : 'there')
  return {
    components: [
      { type: 'body', parameters: [name, v.item, v.business].map((text) => ({ type: 'text', text })) },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: v.suffix }] },
    ],
    /** What the customer reads (stored as the message text in the inbox). */
    text:
      lang === 'es'
        ? `Hola ${name}, ¡buenas noticias! Ya tenemos stock de ${v.item} en ${v.business}, como nos pediste. Toca el botón para verlo.`
        : `Hi ${name}, good news! ${v.item} is back in stock at ${v.business}, as you asked. Tap the button to see it.`,
  }
}

export interface WaitlistTemplateStatus {
  id: string
  name: string
  status: string
  rejection_reason: string | null
  language: string
}

export async function waitlistTemplate(workspaceId: string, lang: Lang): Promise<WaitlistTemplateStatus | null> {
  const row = await tenantDb(workspaceId)
    .message_templates.findFirst({ where: { name: WAITLIST_TEMPLATE_NAMES[lang], language: lang }, select: { id: true, name: true, status: true, rejection_reason: true, language: true } })
    .catch(() => null)
  return row ? { id: row.id, name: row.name, status: row.status ?? 'Draft', rejection_reason: row.rejection_reason, language: row.language ?? lang } : null
}

/**
 * Leaves the template ready as a draft when the business doesn't have it
 * (nothing is sent to Meta: the business does that). `userId` = who creates
 * it (default: the owner).
 */
export async function ensureWaitlistTemplate(workspaceId: string, userId?: string): Promise<void> {
  const db = tenantDb(workspaceId)
  const ws = await prisma.workspaces.findUnique({ where: { id: workspaceId }, select: { slug: true, locale: true } }).catch(() => null)
  if (!ws) return
  const lang: Lang = ws.locale === 'en' ? 'en' : 'es'
  if (await waitlistTemplate(workspaceId, lang)) return
  const creator =
    userId ??
    (await prisma.workspace_members.findFirst({ where: { workspace_id: workspaceId, role: 'owner', status: 'active' }, select: { user_id: true } }).catch(() => null))?.user_id
  if (!creator) return
  try {
    const out = await saveTemplate({ db, workspaceId, userId: creator, draft: waitlistTemplateDraft(lang, ws.slug), submit: false })
    if (!out.ok && out.status !== 409) console.warn(`[waitlist] template draft not created for ${workspaceId}:`, JSON.stringify(out.body))
  } catch (err) {
    console.error(`[waitlist] template draft failed for ${workspaceId}:`, err instanceof Error ? err.message : err)
  }
}
