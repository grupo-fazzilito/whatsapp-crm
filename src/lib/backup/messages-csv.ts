import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { csvEscape } from '@/lib/reports/csv'
import { backupHeader, backupRow, type BackupLang, type BackupMessage } from './messages-format'

// Backup of every conversation as one CSV: a row per message, oldest first,
// with its conversation, channel, contact and who wrote it. Streamed in
// batches so a business with years of messages never loads them all at once.

const BATCH = 2000

export interface BackupOptions {
  workspaceId: string
  from: Date | null
  to: Date | null
  /** Team notes that the customer never saw. */
  includeInternal: boolean
  timeZone: string
  lang: BackupLang
  /** For media saved as /api/media/… paths. */
  origin: string
}

async function batch(o: BackupOptions, after: { at: Date; id: string } | null): Promise<BackupMessage[]> {
  const from = o.from ?? new Date(0)
  const to = o.to ?? new Date('9999-12-31T00:00:00Z')
  const afterAt = after?.at ?? new Date(0)
  const afterId = after?.id ?? '00000000-0000-0000-0000-000000000000'
  return prisma.$queryRaw<BackupMessage[]>`
    SELECT m.id, m.created_at, m.conversation_id, m.sender_type, m.content_type, m.content_text, m.transcript,
           m.media_url, m.template_name, m.status, m.is_internal,
           c.channel_type, c.channel_name, ct.name AS contact_name, ct.phone AS contact_phone, ct.email AS contact_email,
           p.full_name AS agent_name, a.name AS ai_name
      FROM public.messages m
      JOIN public.conversations c ON c.id = m.conversation_id
      LEFT JOIN public.contacts ct ON ct.id = c.contact_id
      LEFT JOIN public.profiles p ON p.user_id = m.sender_id
      LEFT JOIN public.ai_agents a ON a.id = m.ai_agent_id
     WHERE m.workspace_id = ${o.workspaceId}::uuid
       AND m.created_at >= ${from}::timestamptz AND m.created_at < ${to}::timestamptz
       AND (${o.includeInternal}::boolean OR m.is_internal = false)
       AND (m.created_at, m.id) > (${afterAt}::timestamptz, ${afterId}::uuid)
     ORDER BY m.created_at, m.id
     LIMIT ${BATCH}`
}

/** The CSV (Excel-friendly: BOM + CRLF), produced batch by batch. */
export function backupStream(o: BackupOptions): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  const line = (cells: readonly (string | number | null)[]) => enc.encode(`${cells.map(csvEscape).join(',')}\r\n`)
  let after: { at: Date; id: string } | null = null
  let started = false
  let done = false
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!started) {
        started = true
        controller.enqueue(enc.encode('﻿'))
        controller.enqueue(line(backupHeader(o.lang)))
        return
      }
      if (done) return controller.close()
      try {
        const rows = await batch(o, after)
        for (const r of rows) controller.enqueue(line(backupRow(r, o)))
        if (rows.length < BATCH) done = true
        else after = { at: rows[rows.length - 1].created_at!, id: rows[rows.length - 1].id }
      } catch (err) {
        console.error('[backup] export failed:', err instanceof Error ? err.message : err)
        controller.error(err)
      }
    },
  })
}
