import 'server-only'
import { prisma } from '@/lib/db/prisma'
import { tenantDb } from '@/lib/db/tenant'
import { getPlatformSetting } from '@/lib/platform/settings'
import { sendEmail } from '@/lib/email/send'
import { signedUrl } from '@/lib/storage'
import type { NewTicket, TicketAttachment, TicketStatus } from './input'

// Support tickets: businesses ↔ platform team. Business side uses the
// tenant client; the admin panel uses the platform client.

const TICKET_SELECT = {
  id: true,
  number: true,
  workspace_id: true,
  user_id: true,
  subject: true,
  category: true,
  priority: true,
  status: true,
  last_message_at: true,
  closed_at: true,
  created_at: true,
} as const

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3001').replace(/\/+$/, '')
}

/** Attachments with short-lived download links. */
function withLinks(list: unknown): (TicketAttachment & { url: string })[] {
  return ((Array.isArray(list) ? list : []) as TicketAttachment[]).map((a) => ({ ...a, url: signedUrl('attachments', a.path, 3600, { download: a.name }) }))
}

async function emailTeam(subject: string, text: string) {
  const general = await getPlatformSetting<{ support_email?: string }>('general').catch(() => null)
  const to = general?.support_email || process.env.SUPPORT_EMAIL
  if (!to) return
  await sendEmail({ to, subject, text }).catch((err) => console.warn('[support] email failed:', err instanceof Error ? err.message : err))
}

export async function createTicket(input: { workspaceId: string; userId: string; ticket: NewTicket }) {
  const db = tenantDb(input.workspaceId)
  const now = new Date().toISOString()
  const created = await prisma.$transaction(async (tx) => {
    const t = await tx.support_tickets.create({
      data: { workspace_id: input.workspaceId, user_id: input.userId, subject: input.ticket.subject, category: input.ticket.category, priority: input.ticket.priority, last_message_at: now },
      select: TICKET_SELECT,
    })
    await tx.support_ticket_messages.create({
      data: { ticket_id: t.id, workspace_id: input.workspaceId, author_id: input.userId, author_role: 'customer', body: input.ticket.body, attachments: input.ticket.attachments as object[] },
    })
    return t
  })
  const [ws, user] = await Promise.all([
    db.workspaces.findUnique({ where: { id: input.workspaceId }, select: { name: true } }),
    prisma.users.findUnique({ where: { id: input.userId }, select: { email: true, name: true } }),
  ])
  await emailTeam(
    `[Ticket #${created.number}] ${created.subject}`,
    `${ws?.name ?? ''} — ${user?.name ?? ''} <${user?.email ?? ''}>\nCategoría: ${created.category} · Prioridad: ${created.priority}\n\n${input.ticket.body}\n\n${siteUrl()}/admin-panel/support/${created.id}`,
  )
  return created
}

export async function listTickets(workspaceId: string) {
  return tenantDb(workspaceId).support_tickets.findMany({ where: { workspace_id: workspaceId }, select: TICKET_SELECT, orderBy: { last_message_at: 'desc' }, take: 200 })
}

async function messagesOf(ticketId: string) {
  const rows = await prisma.support_ticket_messages.findMany({ where: { ticket_id: ticketId }, orderBy: { created_at: 'asc' } })
  const authors = await prisma.profiles.findMany({
    where: { user_id: { in: [...new Set(rows.map((r) => r.author_id).filter((x): x is string => !!x))] } },
    select: { user_id: true, full_name: true },
  })
  const name = new Map(authors.map((a) => [a.user_id, a.full_name]))
  return rows.map((r) => ({
    id: r.id,
    author_role: r.author_role,
    author_name: r.author_role === 'support' ? null : (r.author_id ? name.get(r.author_id) ?? null : null),
    body: r.body,
    attachments: withLinks(r.attachments),
    created_at: r.created_at,
  }))
}

/** Ticket of this workspace with its messages, or null. */
export async function getTicket(workspaceId: string, id: string) {
  const ticket = await tenantDb(workspaceId).support_tickets.findFirst({ where: { id, workspace_id: workspaceId }, select: TICKET_SELECT })
  return ticket ? { ticket, messages: await messagesOf(id) } : null
}

/** Business reply: reopens the ticket and tells the team. */
export async function customerReply(input: { workspaceId: string; userId: string; ticketId: string; body: string; attachments: TicketAttachment[] }) {
  const db = tenantDb(input.workspaceId)
  const ticket = await db.support_tickets.findFirst({ where: { id: input.ticketId, workspace_id: input.workspaceId }, select: TICKET_SELECT })
  if (!ticket) return null
  const now = new Date().toISOString()
  await prisma.$transaction([
    prisma.support_ticket_messages.create({
      data: { ticket_id: ticket.id, workspace_id: input.workspaceId, author_id: input.userId, author_role: 'customer', body: input.body, attachments: input.attachments as object[] },
    }),
    prisma.support_tickets.update({ where: { id: ticket.id }, data: { status: 'open', closed_at: null, last_message_at: now } }),
  ])
  await emailTeam(`[Ticket #${ticket.number}] Nueva respuesta: ${ticket.subject}`, `${input.body}\n\n${siteUrl()}/admin-panel/support/${ticket.id}`)
  return getTicket(input.workspaceId, ticket.id)
}

export async function customerClose(workspaceId: string, ticketId: string) {
  const r = await tenantDb(workspaceId).support_tickets.updateMany({ where: { id: ticketId, workspace_id: workspaceId }, data: { status: 'closed', closed_at: new Date().toISOString() } })
  return r.count > 0
}

// ── Platform admin ────────────────────────────────────────────

export async function adminListTickets(status: TicketStatus | 'active' | null) {
  const where = status === 'active' ? { status: { not: 'closed' } } : status ? { status } : {}
  const rows = await prisma.support_tickets.findMany({ where, select: { ...TICKET_SELECT, workspaces: { select: { name: true } } }, orderBy: { last_message_at: 'desc' }, take: 300 })
  const counts = await prisma.support_tickets.groupBy({ by: ['status'], _count: { _all: true } })
  return {
    tickets: rows.map(({ workspaces, ...t }) => ({ ...t, workspace_name: workspaces?.name ?? '' })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])),
  }
}

export async function adminGetTicket(id: string) {
  const ticket = await prisma.support_tickets.findUnique({ where: { id }, select: { ...TICKET_SELECT, workspaces: { select: { name: true } } } })
  if (!ticket) return null
  const user = ticket.user_id ? await prisma.users.findUnique({ where: { id: ticket.user_id }, select: { email: true, name: true } }) : null
  const { workspaces, ...rest } = ticket
  return { ticket: { ...rest, workspace_name: workspaces?.name ?? '', requester: user }, messages: await messagesOf(id) }
}

/** Support reply: notifies the requester (bell + email). */
export async function supportReply(input: { ticketId: string; adminId: string; body: string; status?: TicketStatus }) {
  const ticket = await prisma.support_tickets.findUnique({ where: { id: input.ticketId }, select: TICKET_SELECT })
  if (!ticket) return null
  const now = new Date().toISOString()
  const status = input.status ?? 'waiting_customer'
  await prisma.$transaction([
    prisma.support_ticket_messages.create({
      data: { ticket_id: ticket.id, workspace_id: ticket.workspace_id, author_id: input.adminId, author_role: 'support', body: input.body },
    }),
    prisma.support_tickets.update({ where: { id: ticket.id }, data: { status, last_message_at: now, closed_at: status === 'closed' ? now : null } }),
  ])
  if (ticket.user_id) {
    await prisma.notifications
      .create({
        data: {
          workspace_id: ticket.workspace_id,
          user_id: ticket.user_id,
          type: 'system',
          title: `Soporte respondió tu ticket #${ticket.number}`,
          body: input.body.slice(0, 280),
          link: `/support?ticket=${ticket.id}`,
        },
      })
      .catch(() => {})
    const user = await prisma.users.findUnique({ where: { id: ticket.user_id }, select: { email: true } })
    if (user?.email) {
      await sendEmail({ to: user.email, subject: `Respuesta a tu ticket #${ticket.number}: ${ticket.subject}`, text: `${input.body}\n\n${siteUrl()}/support?ticket=${ticket.id}` }).catch(() => {})
    }
  }
  return adminGetTicket(ticket.id)
}

export async function adminSetStatus(ticketId: string, status: TicketStatus) {
  const r = await prisma.support_tickets.updateMany({ where: { id: ticketId }, data: { status, closed_at: status === 'closed' ? new Date().toISOString() : null } })
  return r.count > 0
}

/** Chat online: the platform's own web chat channel (admin panel → Soporte). */
export interface SupportSettings {
  webchat_key?: string
  whatsapp?: string
}

export async function supportSettings(): Promise<SupportSettings> {
  return (await getPlatformSetting<SupportSettings>('support')) ?? {}
}
