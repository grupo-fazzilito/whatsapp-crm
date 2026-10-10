import { NextResponse } from 'next/server'
import { Prisma } from '@/generated/prisma/client'
import { requireWorkspace } from '@/lib/workspace/context'
import { isUuid } from '@/lib/workspace/constants'
import { defaultChannel, loadChannel } from '@/lib/channels/store'

/**
 * Sync message templates from Meta → local message_templates table.
 *
 * Why this exists:
 *   The Settings → Message Templates UI only writes to our database. It does
 *   NOT submit templates for approval to Meta. Users would create a
 *   template locally, try to broadcast with it, and hit Meta's error
 *   #132001 "Template name does not exist in the translation" — because
 *   Meta had never seen the template, or had it approved under a
 *   different language code than what we stored locally.
 *
 *   This route pulls the source of truth (Meta's approved templates)
 *   and upserts them into the local catalog by (workspace_id, name, language).
 *   After a sync, every local template row is guaranteed to match
 *   something Meta will actually accept on send.
 *
 * Scope:
 *   - Read-only against Meta. We never push local → Meta (template
 *     submission happens in Meta's WhatsApp Manager and requires human
 *     review).
 *   - Only approved templates are surfaced by default. We return
 *     everything Meta returns and let the UI filter — so the user can
 *     see their Pending / Rejected templates and understand why.
 *   - Locally-created templates (no Meta counterpart) are NOT deleted —
 *     they remain visible so the user can notice drift and clean up
 *     manually.
 *
 * Body (optional): { channel_id } — the WhatsApp channel whose WABA to
 * sync (token from its secrets, WABA id from channels.settings.waba_id).
 * Defaults to the workspace's default WhatsApp channel.
 */

const META_API_VERSION = 'v21.0'
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`

interface MetaTemplateComponent {
  type: string
  text?: string
  format?: string
  buttons?: any[]
}

interface MetaTemplate {
  id: string
  name: string
  language: string
  status: 'APPROVED' | 'PENDING' | 'REJECTED' | 'PAUSED'
  rejected_reason?: string
  category: string
  components?: MetaTemplateComponent[]
}

/**
 * Meta's template categories are upper-snake (MARKETING / UTILITY /
 * AUTHENTICATION); our DB CHECK constraint is TitleCase. Normalize.
 */
function normalizeCategory(
  meta: string,
): 'Marketing' | 'Utility' | 'Authentication' {
  const upper = meta.toUpperCase()
  if (upper === 'UTILITY') return 'Utility'
  if (upper === 'AUTHENTICATION') return 'Authentication'
  return 'Marketing'
}

/**
 * Meta's template status is UPPERCASE; our DB uses TitleCase.
 */
function normalizeStatus(
  meta: string,
): 'Draft' | 'Pending' | 'Approved' | 'Rejected' {
  switch (meta.toUpperCase()) {
    case 'APPROVED':
      return 'Approved'
    case 'PENDING':
    case 'IN_APPEAL':
    case 'PENDING_DELETION':
      return 'Pending'
    case 'REJECTED':
    case 'DISABLED':
    case 'PAUSED':
      return 'Rejected'
    default:
      return 'Draft'
  }
}

/** Meta buttons → the editor's button shape (OTP and other special buttons are skipped). */
function editorButtons(buttons: any[] | undefined): Prisma.InputJsonValue | typeof Prisma.DbNull {
  const out = (buttons ?? []).flatMap((b) => {
    if (b?.type === 'QUICK_REPLY') return [{ type: 'quick_reply', text: String(b.text ?? '') }]
    if (b?.type === 'URL') return [{ type: 'url', text: String(b.text ?? ''), value: String(b.url ?? ''), ...(Array.isArray(b.example) && b.example[0] ? { example: String(b.example[0]).split('/').pop() } : {}) }]
    if (b?.type === 'PHONE_NUMBER') return [{ type: 'phone', text: String(b.text ?? ''), value: String(b.phone_number ?? '') }]
    return []
  })
  return out.length ? out : Prisma.DbNull
}

/** Placeholder variables for a template created outside Whasalia ({{1}} → "Variable 1"). */
function positionalVariables(body: string) {
  const seen = [...new Set([...body.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((m) => Number(m[1])))].sort((a, b) => a - b)
  return seen.map((n) => ({ key: `variable_${n}`, label: `Variable ${n}`, example: '', source: 'manual', index: n }))
}

export async function POST(request: Request) {
  try {
    // message_templates writes are admin-only.
    const guard = await requireWorkspace('admin')
    if (!guard.ok) return guard.response
    const { db, workspace } = guard.ctx

    const reqBody = (await request.json().catch(() => ({}))) as { channel_id?: string }
    const channel = reqBody.channel_id
      ? isUuid(reqBody.channel_id)
        ? await loadChannel(workspace.id, reqBody.channel_id)
        : null
      : await defaultChannel(workspace.id, 'whatsapp')

    const accessToken = channel?.secrets.access_token
    if (!channel || channel.type !== 'whatsapp' || !accessToken) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Connect your WhatsApp Business account in Settings first.',
        },
        { status: 400 },
      )
    }

    const wabaId = typeof channel.settings?.waba_id === 'string' ? channel.settings.waba_id : ''
    if (!wabaId) {
      return NextResponse.json(
        {
          error:
            'WABA (WhatsApp Business Account) ID missing. Re-connect your account in Settings.',
        },
        { status: 400 },
      )
    }

    // Paginate through every template Meta has for this WABA. Meta
    // returns at most 100 per page; `paging.next` is a full URL. Cap
    // at 20 pages (2k templates) as a safety against infinite loops
    // from a misbehaving upstream.
    const metaTemplates: MetaTemplate[] = []
    let nextUrl:
      | string
      | null = `${META_API_BASE}/${wabaId}/message_templates?limit=100&fields=id,name,language,status,category,components,rejected_reason`
    const PAGE_CAP = 20
    let pageCount = 0

    while (nextUrl && pageCount < PAGE_CAP) {
      pageCount++
      const metaRes: Response = await fetch(nextUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!metaRes.ok) {
        let metaErr = `Meta API error: ${metaRes.status}`
        try {
          const body = await metaRes.json()
          if (body?.error?.message) metaErr = body.error.message
        } catch {
          // response wasn't JSON — keep the fallback
        }
        return NextResponse.json({ error: metaErr }, { status: 502 })
      }

      const metaBody: {
        data?: MetaTemplate[]
        paging?: { next?: string }
      } = await metaRes.json()
      if (metaBody.data) metaTemplates.push(...metaBody.data)
      nextUrl = metaBody.paging?.next ?? null
    }

    // For each Meta template: upsert by (workspace_id, name, language)
    // (unique since migration 022), tagging the row with the channel.
    let inserted = 0
    let updated = 0
    const errors: { name: string; language: string; message: string }[] = []

    for (const t of metaTemplates) {
      const body = (t.components ?? []).find((c) => c.type === 'BODY')
      const header = (t.components ?? []).find((c) => c.type === 'HEADER')
      const footer = (t.components ?? []).find((c) => c.type === 'FOOTER')
      const buttonsComp = (t.components ?? []).find((c) => c.type === 'BUTTONS')

      const status = normalizeStatus(t.status)
      const row = {
        workspace_id: workspace.id,
        channel_id: channel.id,
        name: t.name,
        category: normalizeCategory(t.category),
        language: t.language,
        header_type: header?.format?.toLowerCase() ?? null,
        header_content: header?.text ?? null,
        body_text: body?.text ?? '',
        footer_text: footer?.text ?? null,
        buttons: editorButtons(buttonsComp?.buttons),
        status,
        meta_template_id: t.id,
        rejection_reason: status === 'Rejected' ? (t.rejected_reason && t.rejected_reason !== 'NONE' ? t.rejected_reason : t.status) : null,
        updated_at: new Date().toISOString(),
      }
      const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

      let existing: { id: string } | null
      try {
        existing = await db.message_templates.findFirst({
          select: { id: true },
          where: { workspace_id: workspace.id, name: t.name, language: t.language },
        })
      } catch (err) {
        errors.push({
          name: t.name,
          language: t.language,
          message: message(err),
        })
        continue
      }

      if (existing?.id) {
        try {
          await db.message_templates.updateMany({ where: { id: existing.id }, data: row })
          updated++
        } catch (err) {
          errors.push({
            name: t.name,
            language: t.language,
            message: message(err),
          })
        }
      } else {
        try {
          await db.message_templates.create({ data: { ...row, variables: positionalVariables(row.body_text) as unknown as Prisma.InputJsonValue } })
          inserted++
        } catch (err) {
          errors.push({
            name: t.name,
            language: t.language,
            message: message(err),
          })
        }
      }
    }

    return NextResponse.json({
      success: errors.length === 0,
      total: metaTemplates.length,
      inserted,
      updated,
      errors,
      truncated: pageCount >= PAGE_CAP && nextUrl !== null,
    })
  } catch (error) {
    console.error('Error syncing WhatsApp templates:', error)
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : 'Failed to sync templates',
      },
      { status: 500 },
    )
  }
}
