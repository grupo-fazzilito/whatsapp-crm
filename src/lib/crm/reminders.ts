import 'server-only'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { createTranslator } from '@/i18n/translate'

// Due reminders for tasks: one in-app notification per task, sent to the
// assignee (or the creator when nobody is assigned) when the task is about
// to be due (REMINDER_LEAD_MIN before) or already overdue. tasks.reminded_at
// is the claim, so overlapping cron runs never notify twice; changing the
// due date or reopening the task re-arms it (DB trigger).
//
// Notifications live in the `notifications` table (inbox work, migration
// 032). If that table doesn't exist yet we skip silently without claiming,
// so tasks get reminded once it ships.

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

function missingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === '42P01' || err.code === 'PGRST205' || /does not exist|could not find the table/i.test(err.message ?? '')
}

export async function remindDueTasks(now: Date = new Date()): Promise<RemindResult> {
  const db = supabaseAdmin()

  const probe = await db.from('notifications').select('id').limit(1)
  if (missingTable(probe.error)) return { reminded: 0, skipped: 0, notifications: false }

  const { data, error } = await db
    .from('tasks')
    .select('id, workspace_id, title, due_at, assignee_user_id, created_by, contact_id, conversation_id, deal_id, contact:contacts(name, phone), workspace:workspaces(locale, timezone)')
    .eq('status', 'open')
    .is('reminded_at', null)
    .not('due_at', 'is', null)
    .lte('due_at', new Date(now.getTime() + REMINDER_LEAD_MIN * 60_000).toISOString())
    .gte('due_at', new Date(now.getTime() - REMINDER_MAX_AGE_DAYS * 86_400_000).toISOString())
    .order('due_at', { ascending: true })
    .limit(BATCH)
  if (error) throw new Error(error.message)

  let reminded = 0
  let skipped = 0
  for (const row of (data ?? []) as unknown as DueTaskRow[]) {
    const userId = row.assignee_user_id ?? row.created_by
    if (!userId) {
      skipped++
      continue
    }
    // Claim first: only one run wins.
    const { data: claim } = await db
      .from('tasks')
      .update({ reminded_at: now.toISOString() })
      .eq('id', row.id)
      .eq('workspace_id', row.workspace_id)
      .is('reminded_at', null)
      .select('id')
      .maybeSingle()
    if (!claim) {
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
    const { error: insertError } = await db.from('notifications').insert({
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
    })
    if (insertError) {
      // Release the claim so a later run can retry.
      await db.from('tasks').update({ reminded_at: null }).eq('id', row.id).eq('workspace_id', row.workspace_id)
      if (missingTable(insertError)) return { reminded, skipped, notifications: false }
      console.error('[crm] task reminder failed:', insertError.message)
      skipped++
      continue
    }
    reminded++
  }
  return { reminded, skipped, notifications: true }
}
