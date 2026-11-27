import 'server-only'
import { after } from 'next/server'
import { createElement } from 'react'
import { renderToBuffer } from '@react-pdf/renderer'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { createTranslator } from '@/i18n/translate'
import type { AppLocale } from '@/i18n/config'
import { uploadObject } from '@/lib/storage'
import { moneyLocale } from '@/lib/workspace/countries'
import { siteUrl } from '@/lib/integrations/google/endpoints'
import { monthBounds } from '@/lib/meta-usage/rates'
import type { Workspace } from '@/lib/workspace/types'
import { buildReport } from './service'
import { isPreset, resolveRange, type Preset } from './range'
import { loadMetaUsage } from './meta-usage-data'
import { ReportDocument } from './pdf/document'
import type { ReportScope } from './types'

// PDF reports are built in the background: the request only queues a row;
// when the file is ready (or fails) the requester gets an in-app
// notification whose link downloads it.

export interface ExportParams {
  preset: Preset
  from: string | null
  to: string | null
  channelId: string | null
  agentId: string | null
  teamId: string | null
  scope: ReportScope
  locale: AppLocale
}

/** Files are kept this long; after that the link says to generate a new one. */
export const EXPORT_TTL_DAYS = 7

export async function queueReportExport(workspaceId: string, userId: string, params: ExportParams): Promise<string> {
  const row = await tenantDb(workspaceId).report_exports.create({
    data: { workspace_id: workspaceId, user_id: userId, params: params as unknown as object },
    select: { id: true },
  })
  const task = () => runReportExport(row.id).catch((err) => console.error('[reports] export crashed:', err instanceof Error ? err.message : err))
  try {
    after(task)
  } catch {
    void task()
  }
  return row.id
}

function fileName(businessName: string, from: string, to: string, locale: AppLocale): string {
  const slug = businessName
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 40)
  return `${locale === 'en' ? 'report' : 'reporte'}-${slug || 'whasalia'}-${from}_${to}.pdf`
}

/** Builds the PDF of one queued export, stores it and notifies the requester. */
export async function runReportExport(id: string): Promise<void> {
  // Platform read: the job has no session; the row says whose it is.
  const row = await prisma.report_exports.findUnique({ where: { id } })
  if (!row || row.status !== 'pending') return
  const db = tenantDb(row.workspace_id)
  const params = row.params as unknown as ExportParams
  const t = createTranslator(params.locale === 'en' ? 'en' : 'es')
  const notify = (title: string, body: string, link: string) =>
    db.notifications
      .create({ data: { workspace_id: row.workspace_id, user_id: row.user_id, type: 'report', title, body, link } })
      .catch((err) => console.error('[reports] notification failed:', err instanceof Error ? err.message : err))

  try {
    const workspace = (await prisma.workspaces.findUniqueOrThrow({ where: { id: row.workspace_id } })) as unknown as Workspace
    if (!isPreset(params.preset)) throw new Error('invalid preset')
    const range = resolveRange(params.preset, workspace.timezone, new Date(), { from: params.from, to: params.to })
    if (!range) throw new Error('invalid range')
    const result = await buildReport({ workspace, userId: row.user_id, scope: params.scope, range, channelId: params.channelId, agentId: params.agentId, teamId: params.teamId })
    if (!result.ok) throw new Error(result.error)
    const report = result.report
    // WhatsApp (Meta) usage: workspace view only, for the month the range ends in.
    let meta = null
    if (params.scope === 'workspace') {
      const bounds = monthBounds(report.range.toDate.slice(0, 7))
      if (bounds) {
        meta = await loadMetaUsage(workspace, db, bounds).catch(() => null)
        if (meta && meta.numbers.length === 0) meta = null
      }
    }
    const filters: string[] = []
    const name = <T extends { id: string; name: string }>(list: T[] | null | undefined, idv: string | null) => list?.find((x) => x.id === idv)?.name
    if (params.channelId) filters.push(`${t('reports.cols.channel')}: ${name(report.options.channels, params.channelId) ?? '—'}`)
    if (params.agentId && params.scope === 'workspace') filters.push(`${t('reports.cols.agent')}: ${name(report.options.agents, params.agentId) ?? '—'}`)
    if (params.teamId) filters.push(`${t('inboxpro.teams.title')}: ${name(report.options.teams, params.teamId) ?? '—'}`)

    const element = createElement(ReportDocument, {
      report,
      meta,
      businessName: workspace.name,
      t,
      numLocale: moneyLocale({ locale: params.locale, country: workspace.country }),
      siteUrl: siteUrl(),
      filters,
    })
    // renderToBuffer's typing wants a <Document> element; ReportDocument returns one.
    const pdf = await renderToBuffer(element as unknown as Parameters<typeof renderToBuffer>[0])
    const file = fileName(workspace.name, report.range.fromDate, report.range.toDate, params.locale)
    const path = `${row.workspace_id}/reports/${id}.pdf`
    await uploadObject('attachments', path, pdf, 'application/pdf', { upsert: true })
    await db.report_exports.updateMany({ where: { id }, data: { status: 'ready', file_path: path, file_name: file, finished_at: new Date() } })
    await notify(t('reports.pdf.readyTitle'), t('reports.pdf.readyBody', { name: file }), `/api/reports/exports/${id}`)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[reports] export failed:', message)
    await db.report_exports.updateMany({ where: { id }, data: { status: 'failed', error: message.slice(0, 500), finished_at: new Date() } }).catch(() => undefined)
    await notify(t('reports.pdf.failedTitle'), t('reports.pdf.failedBody'), '/reports')
  }
}
