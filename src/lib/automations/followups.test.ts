import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import type { Prisma } from '@/generated/prisma/client'
import { pgTest } from '@/lib/test-utils/pg'

// Real Postgres (TEST_DATABASE_URL); skipped without it. The module under
// test is imported after pgTest() points DATABASE_URL at the test database.
const pg = await pgTest()
const { armFollowupsForOutbound, cancelFollowupsForInbound } = pg
  ? await import('./followups')
  : ({} as typeof import('./followups'))

const NOW = new Date('2026-10-07T12:00:00.000Z')

describe.skipIf(!pg)('follow-ups (Postgres)', () => {
  let ws: Awaited<ReturnType<NonNullable<typeof pg>['workspace']>>
  let other: typeof ws
  let contactId: string
  let conversationId: string
  let otherConversationId: string
  let messageId: string

  beforeAll(async () => {
    ws = await pg!.workspace()
    other = await pg!.workspace()
    const contact = await ws.db.contacts.create({ data: { workspace_id: ws.workspaceId, name: 'Ana', phone: '+51987654321' } })
    contactId = contact.id
    const conv = await ws.db.conversations.create({ data: { workspace_id: ws.workspaceId, contact_id: contactId } })
    conversationId = conv.id
    const conv2 = await ws.db.conversations.create({ data: { workspace_id: ws.workspaceId, contact_id: contactId } })
    otherConversationId = conv2.id
    const msg = await ws.db.messages.create({
      data: { workspace_id: ws.workspaceId, conversation_id: conversationId, sender_type: 'bot', content_text: 'hola' },
    })
    messageId = msg.id
  })

  afterAll(async () => {
    await pg!.cleanup(ws, other)
  })

  beforeEach(async () => {
    await ws.db.followup_schedules.deleteMany({ where: {} })
    await ws.db.automation_pending_executions.deleteMany({ where: {} })
    await ws.db.automations.deleteMany({ where: {} })
  })

  async function automation(name: string, triggerConfig: Prisma.InputJsonObject, opts: { active?: boolean; workspace?: typeof ws } = {}) {
    const w = opts.workspace ?? ws
    return w.db.automations.create({
      data: { workspace_id: w.workspaceId, name, trigger_type: 'no_reply', trigger_config: triggerConfig, is_active: opts.active ?? true },
    })
  }

  const base = () => ({
    workspaceId: ws.workspaceId,
    conversationId,
    contactId,
    channelId: 'ch1',
    messageId,
    status: 'sent',
    now: NOW,
  })

  describe('armFollowupsForOutbound', () => {
    it('upserts one schedule per matching active no_reply automation', async () => {
      const a1 = await automation('a1', { after: { amount: 2, unit: 'hours' } })
      await automation('a2', { after: { amount: 1, unit: 'days' }, channel_ids: ['other'] })
      await automation('a3', { after: { amount: 0, unit: 'hours' } })
      await automation('inactive', { after: { amount: 1, unit: 'hours' } }, { active: false })
      await automation('other workspace', { after: { amount: 1, unit: 'hours' } }, { workspace: other })

      expect(await armFollowupsForOutbound(base())).toBe(1)

      const rows = await ws.db.followup_schedules.findMany({ where: {} })
      expect(rows).toEqual([
        expect.objectContaining({
          workspace_id: ws.workspaceId,
          automation_id: a1.id,
          conversation_id: conversationId,
          contact_id: contactId,
          anchor_message_id: messageId,
          anchored_at: '2026-10-07T12:00:00.000Z',
          due_at: '2026-10-07T14:00:00.000Z',
          status: 'pending',
          fired_at: null,
          cancelled_at: null,
        }),
      ])
      expect(await other.db.followup_schedules.count({ where: {} })).toBe(0)
    })

    it('re-arming replaces the schedule of the same automation + conversation', async () => {
      await automation('a1', { after: { amount: 2, unit: 'hours' } })
      await armFollowupsForOutbound(base())
      await ws.db.followup_schedules.updateMany({ where: {}, data: { status: 'cancelled', cancelled_at: NOW.toISOString() } })

      const later = new Date('2026-10-07T13:00:00.000Z')
      expect(await armFollowupsForOutbound({ ...base(), now: later })).toBe(1)

      const rows = await ws.db.followup_schedules.findMany({ where: {} })
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({ status: 'pending', cancelled_at: null, due_at: '2026-10-07T15:00:00.000Z' })
    })

    it('does nothing for follow-up sends, failures and broadcasts', async () => {
      await automation('a1', { after: { amount: 2, unit: 'hours' } })
      expect(await armFollowupsForOutbound({ ...base(), metadata: { followup: true } })).toBe(0)
      expect(await armFollowupsForOutbound({ ...base(), status: 'failed' })).toBe(0)
      expect(await armFollowupsForOutbound({ ...base(), metadata: { source: 'broadcast' } })).toBe(0)
      expect(await ws.db.followup_schedules.count({ where: {} })).toBe(0)
    })

    it('does not upsert when no automation applies', async () => {
      expect(await armFollowupsForOutbound(base())).toBe(0)
      expect(await ws.db.followup_schedules.count({ where: {} })).toBe(0)
    })
  })

  describe('cancelFollowupsForInbound', () => {
    it('cancels pending schedules and parked follow-up waits of the conversation', async () => {
      const a = await automation('a1', { after: { amount: 2, unit: 'hours' } })
      await armFollowupsForOutbound(base())
      await armFollowupsForOutbound({ ...base(), conversationId: otherConversationId, messageId: (await ws.db.messages.create({
        data: { workspace_id: ws.workspaceId, conversation_id: otherConversationId, sender_type: 'bot', content_text: 'x' },
      })).id })

      const wait = (context: Prisma.InputJsonObject) =>
        ws.db.automation_pending_executions.create({
          data: { workspace_id: ws.workspaceId, automation_id: a.id, next_step_position: 1, run_at: NOW.toISOString(), context },
        })
      const followupWait = await wait({ conversation_id: conversationId, followup: true })
      const plainWait = await wait({ conversation_id: conversationId })
      const otherConvWait = await wait({ conversation_id: otherConversationId, followup: true })

      await cancelFollowupsForInbound(ws.workspaceId, conversationId)

      const schedules = await ws.db.followup_schedules.findMany({ where: {}, orderBy: { conversation_id: 'asc' } })
      const byConv = Object.fromEntries(schedules.map((s) => [s.conversation_id, s]))
      expect(byConv[conversationId]).toMatchObject({ status: 'cancelled' })
      expect(byConv[conversationId].cancelled_at).not.toBeNull()
      expect(byConv[otherConversationId]).toMatchObject({ status: 'pending', cancelled_at: null })

      const waits = Object.fromEntries(
        (await ws.db.automation_pending_executions.findMany({ where: {} })).map((w) => [w.id, w.status]),
      )
      expect(waits[followupWait.id]).toBe('cancelled')
      expect(waits[plainWait.id]).toBe('pending')
      expect(waits[otherConvWait.id]).toBe('pending')
    })

    it('throws when the DB fails (callers log it)', async () => {
      await expect(cancelFollowupsForInbound(ws.workspaceId, 'not-a-uuid')).rejects.toThrow('followup cancel failed')
    })
  })
})
