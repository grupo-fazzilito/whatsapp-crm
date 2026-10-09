import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { createTranslator } from '@/i18n/translate'

// Due reminders for tasks: one in-app notification per task, sent to the
// assignee (or the creator when nobody is assigned) when the task is about
// to be due (REMINDER_LEAD_MIN before) or already overdue. tasks.reminded_at
// is the claim, so overlapping cron runs never notify twice; changing the
// due date or reopening the task re-arms it (DB trigger).
//
// Notifications live in the `notifications` table (inbox work, migration
// 032), part of the Postgres baseline (`notifications` is always true now).

export const REMINDER_LEAD_MIN = 15
/** Overdue tasks older than this are not reminded (avoids a flood on first run). */
export const REMINDER_MAX_AGE_DAYS = 7
const BATCH = 100

export interface RemindResult {
  reminded: number
  skipped: number
  notifications: boolean
}

interface DueTaskRow {
  id: string
  workspace_id: string
  title: string
  due_at: string
  assignee_user_id: string | null
  created_by: string | null
  contact_id: string | null
  conversation_id: string | null
  deal_id: string | null
  contact: { name: string | null; phone: string | null } | null
  workspace: { locale: string | null; timezone: string | null } | null
}

export async function remindDueTasks(now: Date = new Date()): Promise<RemindResult> {
  // Platform cron over every workspace.
  const data = await prisma.tasks.findMany({
    select: {
      id: true,
      workspace_id: true,
      title: true,
      due_at: true,
      assignee_user_id: true,
      created_by: true,
      contact_id: true,
      conversation_id: true,
      deal_id: true,
      contacts: { select: { name: true, phone: true } },
      workspaces: { select: { locale: true, timezone: true } },
    },
    where: {
      status: 'open',
      reminded_at: null,
      due_at: {
        not: null,
        lte: new Date(now.getTime() + REMINDER_LEAD_MIN * 60_000),
        gte: new Date(now.getTime() - REMINDER_MAX_AGE_DAYS * 86_400_000),
      },
    },
    orderBy: { due_at: 'asc' },
    take: BATCH,
  })

  let reminded = 0
  let skipped = 0
  for (const { contacts, workspaces, ...rest } of data) {
    const row = { ...rest, contact: contacts, workspace: workspaces } as unknown as DueTaskRow
    const db = tenantDb(row.workspace_id)
    const userId = row.assignee_user_id ?? row.created_by
    if (!userId) {
      skipped++
      continue
    }
    // Claim first: only one run wins.
    const claim = await db.tasks.updateMany({ where: { id: row.id, reminded_at: null }, data: { reminded_at: now } })
    if (!claim.count) {
      skipped++
      continue
    }

    const locale = row.workspace?.locale === 'en' ? 'en' : 'es'
    const t = createTranslator(locale)
    const due = new Date(row.due_at)
    const overdue = due.getTime() <= now.getTime()
    const when = new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-PE', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: row.workspace?.timezone || undefined,
    }).format(due)
    const who = row.contact?.name || row.contact?.phone || null

    // notifications.type is limited to mention|assigned|transferred|system (032).
    try {
      await db.notifications.create({
        data: {
          workspace_id: row.workspace_id,
          user_id: userId,
          type: 'system',
          title: t(overdue ? 'crm.reminders.overdueTitle' : 'crm.reminders.dueTitle', { title: row.title }).slice(0, 200),
          body: who
            ? t(overdue ? 'crm.reminders.bodyOverdueContact' : 'crm.reminders.bodyContact', { when, contact: who })
            : t(overdue ? 'crm.reminders.bodyOverdue' : 'crm.reminders.body', { when }),
          // The task itself (the sheet links to the chat).
          link: `/tasks?task=${row.id}`,
          conversation_id: row.conversation_id,
        },
      })
    } catch (insertError) {
      // Release the claim so a later run can retry.
      await db.tasks.updateMany({ where: { id: row.id }, data: { reminded_at: null } })
      console.error('[crm] task reminder failed:', insertError instanceof Error ? insertError.message : insertError)
      skipped++
      continue
    }
    reminded++
  }
  return { reminded, skipped, notifications: true }
}
