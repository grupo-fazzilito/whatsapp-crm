// Pure task helpers shared by the /tasks page, the conversation CRM panel
// and the reminder cron. Day boundaries use the runtime's local time zone
// (the browser's in the UI).

export const TASK_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const
export type TaskPriority = (typeof TASK_PRIORITIES)[number]

export const TASK_STATUSES = ['open', 'done', 'cancelled'] as const
export type TaskStatus = (typeof TASK_STATUSES)[number]

export interface Task {
  id: string
  workspace_id: string
  title: string
  description: string | null
  due_at: string | null
  priority: TaskPriority
  status: TaskStatus
  result: string | null
  assignee_user_id: string | null
  contact_id: string | null
  conversation_id: string | null
  deal_id: string | null
  created_by: string | null
  completed_at: string | null
  completed_by: string | null
  reminded_at: string | null
  created_at: string
  updated_at: string
}

/** Task row with the joins the UI shows. */
export interface TaskRow extends Task {
  contact?: { id: string; name: string | null; phone: string | null } | null
  deal?: { id: string; title: string } | null
}

/** Window event fired after any CRM write from the shared widgets (panel listens). */
export const CRM_CHANGED_EVENT = 'crm:changed'
export function notifyCrmChanged() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CRM_CHANGED_EVENT))
}

export const TASK_SELECT = '*, contact:contacts(id, name, phone), deal:deals(id, title)'

export type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'
export const DUE_BUCKETS: DueBucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none']

export function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d)
  x.setDate(x.getDate() + n)
  return x
}

export function isOverdue(t: Pick<Task, 'due_at' | 'status'>, now: Date = new Date()): boolean {
  return t.status === 'open' && !!t.due_at && new Date(t.due_at).getTime() < now.getTime()
}

/** Where an open task falls relative to `now` (overdue = due time already passed). */
export function dueBucket(dueAt: string | null, now: Date = new Date()): DueBucket {
  if (!dueAt) return 'none'
  const due = new Date(dueAt)
  if (Number.isNaN(due.getTime())) return 'none'
  if (due.getTime() < now.getTime()) return 'overdue'
  const today = startOfDay(now)
  if (due < addDays(today, 1)) return 'today'
  if (due < addDays(today, 2)) return 'tomorrow'
  if (due < addDays(today, 8)) return 'week'
  return 'later'
}

/** Open tasks grouped by due bucket (bucket order), soonest first inside each. */
export function groupByDue<T extends Pick<Task, 'due_at' | 'priority'>>(tasks: T[], now: Date = new Date()): { bucket: DueBucket; tasks: T[] }[] {
  const map = new Map<DueBucket, T[]>()
  for (const t of tasks) {
    const b = dueBucket(t.due_at, now)
    const list = map.get(b) ?? []
    list.push(t)
    map.set(b, list)
  }
  return DUE_BUCKETS.filter((b) => map.has(b)).map((bucket) => ({ bucket, tasks: sortTasks(map.get(bucket)!) }))
}

const PRIORITY_RANK: Record<TaskPriority, number> = { urgent: 0, high: 1, normal: 2, low: 3 }

/** Due date ascending (no date last), then priority (urgent first). */
export function sortTasks<T extends Pick<Task, 'due_at' | 'priority'>>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const da = a.due_at ? new Date(a.due_at).getTime() : Infinity
    const db = b.due_at ? new Date(b.due_at).getTime() : Infinity
    if (da !== db) return da - db
    return (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9)
  })
}

export type DuePreset = 'none' | 'in1h' | 'today' | 'tomorrow' | 'next_week'
export const DUE_PRESETS: DuePreset[] = ['none', 'in1h', 'today', 'tomorrow', 'next_week']

/**
 * Quick due dates: "today" = 18:00 today (or in 1 hour when that already
 * passed), "tomorrow" / "next week" = 09:00 that day.
 */
export function presetDue(preset: DuePreset, now: Date = new Date()): Date | null {
  switch (preset) {
    case 'none':
      return null
    case 'in1h':
      return new Date(now.getTime() + 3_600_000)
    case 'today': {
      const d = startOfDay(now)
      d.setHours(18)
      return d.getTime() > now.getTime() ? d : new Date(now.getTime() + 3_600_000)
    }
    case 'tomorrow': {
      const d = addDays(startOfDay(now), 1)
      d.setHours(9)
      return d
    }
    case 'next_week': {
      const d = addDays(startOfDay(now), 7)
      d.setHours(9)
      return d
    }
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** ISO timestamp → value for <input type="datetime-local"> in local time. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** <input type="datetime-local"> value → ISO timestamp (null when empty/invalid). */
export function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export type TaskView = 'open' | 'overdue' | 'today' | 'upcoming' | 'done'
export const TASK_VIEWS: TaskView[] = ['open', 'overdue', 'today', 'upcoming', 'done']

/** Client-side filter for a view (the query already narrowed by status). */
export function inView(t: Pick<Task, 'status' | 'due_at'>, view: TaskView, now: Date = new Date()): boolean {
  if (view === 'done') return t.status === 'done'
  if (t.status !== 'open') return false
  const b = dueBucket(t.due_at, now)
  switch (view) {
    case 'open':
      return true
    case 'overdue':
      return b === 'overdue'
    case 'today':
      // Everything that needs doing today, including what's already late today.
      return b === 'today' || (b === 'overdue' && !!t.due_at && new Date(t.due_at) >= startOfDay(now))
    case 'upcoming':
      return b === 'tomorrow' || b === 'week' || b === 'later'
  }
}
