// Support ticket input validation. Pure.

export const TICKET_CATEGORIES = ['technical', 'billing', 'whatsapp', 'ai', 'account', 'other'] as const
export const TICKET_PRIORITIES = ['low', 'normal', 'high'] as const
export const TICKET_STATUSES = ['open', 'in_progress', 'waiting_customer', 'closed'] as const
export type TicketCategory = (typeof TICKET_CATEGORIES)[number]
export type TicketPriority = (typeof TICKET_PRIORITIES)[number]
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export interface TicketAttachment {
  path: string
  name: string
  type: string
}

const MAX_ATTACHMENTS = 5

export function parseAttachments(raw: unknown, workspaceId: string): TicketAttachment[] | string {
  if (raw === undefined || raw === null) return []
  if (!Array.isArray(raw) || raw.length > MAX_ATTACHMENTS) return `up to ${MAX_ATTACHMENTS} attachments`
  const out: TicketAttachment[] = []
  for (const a of raw) {
    const x = (a ?? {}) as Record<string, unknown>
    const path = typeof x.path === 'string' ? x.path : ''
    if (!path.startsWith(`${workspaceId}/`) || path.includes('..') || path.length > 500) return 'invalid attachment'
    out.push({ path, name: String(x.name ?? 'archivo').slice(0, 200), type: String(x.type ?? 'application/octet-stream').slice(0, 100) })
  }
  return out
}

export function parseBody(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const t = raw.trim()
  return t.length >= 1 && t.length <= 10000 ? t : null
}

export type NewTicket = { subject: string; category: TicketCategory; priority: TicketPriority; body: string; attachments: TicketAttachment[] }

export function parseNewTicket(b: Record<string, unknown>, workspaceId: string): { ok: true; value: NewTicket } | { ok: false; error: string } {
  const subject = typeof b.subject === 'string' ? b.subject.trim() : ''
  if (subject.length < 3 || subject.length > 160) return { ok: false, error: 'invalid_subject' }
  const category = (TICKET_CATEGORIES as readonly unknown[]).includes(b.category) ? (b.category as TicketCategory) : 'other'
  const priority = (TICKET_PRIORITIES as readonly unknown[]).includes(b.priority) ? (b.priority as TicketPriority) : 'normal'
  const body = parseBody(b.body)
  if (!body) return { ok: false, error: 'invalid_body' }
  const attachments = parseAttachments(b.attachments, workspaceId)
  if (typeof attachments === 'string') return { ok: false, error: 'invalid_attachments' }
  return { ok: true, value: { subject, category, priority, body, attachments } }
}
