import 'server-only'
import { prisma } from '@/lib/db/prisma'
import type { TenantDb } from '@/lib/db/tenant'

// Inbox reads/writes for the browser (behind /api/inbox/*). Every function
// takes the caller's tenant client, so rows of other workspaces are never
// visible; ids coming from the browser only narrow inside that workspace.

const FILE_TYPES = ['image', 'video', 'audio', 'document', 'sticker']

/**
 * Conversations as the inbox list renders them (was the PostgREST select
 * "*, contact:contacts(*, contact_tags(tag_id)), conversation_tags(id, tag_id)"),
 * newest activity first. `id` narrows to one conversation.
 */
export async function listInboxConversations(db: TenantDb, opts: { id?: string } = {}) {
  const rows = await db.conversations.findMany({
    where: opts.id ? { id: opts.id } : {},
    include: {
      contacts: { include: { contact_tags: { select: { tag_id: true } } } },
      conversation_tags: { select: { id: true, tag_id: true } },
    },
    orderBy: { last_message_at: 'desc' },
  })
  return rows.map(({ contacts, ...rest }) => ({ ...rest, contact: contacts ?? null }))
}

/** {id, unread_count, status, needs_human_since} of every conversation (sidebar counters). */
export async function listUnreadCounts(db: TenantDb) {
  return db.conversations.findMany({ select: { id: true, unread_count: true, status: true, needs_human_since: true } })
}

/** Whole thread, oldest first. */
export async function listMessages(db: TenantDb, conversationId: string) {
  return db.messages.findMany({ where: { conversation_id: conversationId }, orderBy: { created_at: 'asc' } })
}

/** Media/documents of a conversation for the "Archivos" panel (newest first, max 300). */
export async function listConversationFiles(db: TenantDb, conversationId: string) {
  return db.messages.findMany({
    select: { id: true, sender_type: true, sender_id: true, ai_agent_id: true, content_type: true, content_text: true, media_url: true, created_at: true },
    where: {
      conversation_id: conversationId,
      is_internal: false,
      content_type: { in: FILE_TYPES },
      media_url: { not: null },
      status: { not: 'failed' },
    },
    orderBy: { created_at: 'desc' },
    take: 300,
  })
}

export async function listReactions(db: TenantDb, conversationId: string) {
  return db.message_reactions.findMany({ where: { conversation_id: conversationId } })
}

export async function listEvents(db: TenantDb, conversationId: string) {
  return db.conversation_events.findMany({ where: { conversation_id: conversationId }, orderBy: { created_at: 'asc' }, take: 500 })
}

/** Clears the unread counter; false when the conversation isn't in the workspace. */
export async function markConversationRead(db: TenantDb, conversationId: string): Promise<boolean> {
  const { count } = await db.conversations.updateMany({ where: { id: conversationId }, data: { unread_count: 0 } })
  return count > 0
}

/** Deletes a failed message (the composer's "retry" resends it). */
export async function deleteFailedMessage(db: TenantDb, messageId: string): Promise<boolean> {
  const { count } = await db.messages.deleteMany({ where: { id: messageId, status: 'failed' } })
  return count > 0
}

/** Channels, AI agents and active members (with profiles) for the inbox lookups. */
export async function inboxDirectory(db: TenantDb) {
  const [channels, agents, members] = await Promise.all([
    db.channels.findMany({
      select: { id: true, type: true, name: true, purpose: true, display_handle: true, status: true, ai_agent_id: true },
      orderBy: { created_at: 'asc' },
    }),
    db.ai_agents.findMany({ select: { id: true, name: true, enabled: true } }),
    db.workspace_members.findMany({ select: { user_id: true }, where: { status: 'active' } }),
  ])
  return { channels, agents, members: await memberProfiles(members.map((m) => m.user_id)) }
}

/** Profiles of the given users (only call with ids of the workspace's members). */
async function memberProfiles(userIds: string[]) {
  if (!userIds.length) return []
  // Platform client: profiles have no workspace column.
  return prisma.profiles.findMany({ where: { user_id: { in: userIds } }, orderBy: { full_name: 'asc' } })
}

/** Active members of the workspace as {user_id, full_name, email} (pickers). */
export async function activeMemberNames(db: TenantDb) {
  const rows = await db.workspace_members.findMany({ select: { user_id: true }, where: { status: 'active' } })
  const ids = rows.map((r) => r.user_id)
  if (!ids.length) return []
  return prisma.profiles.findMany({ select: { user_id: true, full_name: true, email: true }, where: { user_id: { in: ids } } })
}

/** Contact panel data: deals (with stage), notes, tags and channel identities. Null when the contact isn't in the workspace. */
export async function contactPanel(db: TenantDb, contactId: string) {
  const contact = await db.contacts.findFirst({ select: { id: true }, where: { id: contactId } })
  if (!contact) return null
  const [deals, notes, tags, identities] = await Promise.all([
    db.deals.findMany({ where: { contact_id: contactId }, include: { pipeline_stages: true }, orderBy: { created_at: 'desc' } }),
    db.contact_notes.findMany({ where: { contact_id: contactId }, orderBy: { created_at: 'desc' } }),
    db.contact_tags.findMany({ select: { id: true, tag_id: true, tags: true }, where: { contact_id: contactId } }),
    db.contact_identities.findMany({ where: { contact_id: contactId }, orderBy: { created_at: 'asc' } }),
  ])
  return {
    deals: deals.map(({ pipeline_stages, ...d }) => ({ ...d, stage: pipeline_stages ?? null })),
    notes,
    tags,
    identities,
  }
}

/** New note on a contact of the workspace; null when the contact isn't there. */
export async function addContactNote(db: TenantDb, workspaceId: string, userId: string, contactId: string, text: string) {
  const contact = await db.contacts.findFirst({ select: { id: true }, where: { id: contactId } })
  if (!contact) return null
  return db.contact_notes.create({ data: { workspace_id: workspaceId, contact_id: contactId, user_id: userId, note_text: text } })
}

/** Last 5 orders of the contact and its open cart (lines with product/variant name and price). */
export async function contactOrders(db: TenantDb, contactId: string) {
  const [orders, cart] = await Promise.all([
    db.orders.findMany({
      select: { id: true, number: true, status: true, payment_status: true, total: true, currency: true, created_at: true },
      where: { contact_id: contactId },
      orderBy: { created_at: 'desc' },
      take: 5,
    }),
    db.carts.findFirst({
      select: {
        id: true,
        cart_items: {
          select: {
            id: true,
            quantity: true,
            products: { select: { name: true, price: true } },
            product_variants: { select: { name: true, price: true } },
          },
        },
      },
      where: { contact_id: contactId, status: 'open' },
      orderBy: { updated_at: 'desc' },
    }),
  ])
  return {
    orders,
    cart: cart
      ? {
          id: cart.id,
          cart_items: cart.cart_items.map((i) => ({ id: i.id, quantity: i.quantity, product: i.products ?? null, variant: i.product_variants ?? null })),
        }
      : null,
  }
}

/** Approved templates (optionally for one channel, or channel-less), newest first. */
export async function approvedTemplates(db: TenantDb, channelId: string | null) {
  return db.message_templates.findMany({
    where: { status: 'Approved', ...(channelId ? { OR: [{ channel_id: channelId }, { channel_id: null }] } : {}) },
    orderBy: { created_at: 'desc' },
  })
}

/** Workspace tags by name. */
export async function listTags(db: TenantDb) {
  return db.tags.findMany({ orderBy: { name: 'asc' } })
}
