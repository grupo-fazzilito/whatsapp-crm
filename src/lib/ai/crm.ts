import 'server-only'
import { tenantDb } from '@/lib/db/tenant'
import { canSpend, spend } from '@/lib/billing/credits'
import { recordEvent } from '@/lib/inbox/server'
import { zonedTimeToUtc } from '@/lib/bookings/reminders'
import { zonedNow } from './time'
import {
  EXTRA_INFO_KEY,
  EXTRA_INFO_NAME,
  appendExtraInfo,
  describeActions,
  planContact,
  planDeal,
  planTags,
  planTask,
  type CrmAction,
  type CrmContext,
  type CrmOutput,
} from './crm-model'

// The AI agent's writes to the CRM after a turn (agents with crm_actions
// on). Every action written costs credits ('crm_action'); nothing is
// written when the business has none left. Never throws: a CRM hiccup
// must not break the conversation.

/** What the prompt needs: the customer's data, open deals, stages with a meaning, tags and custom fields. */
export async function loadCrmContext(workspaceId: string, contactId: string, industry: string | null): Promise<CrmContext | null> {
  try {
    const db = tenantDb(workspaceId)
    const [contact, pipelines, tags, tagLinks, fields, values] = await Promise.all([
      db.contacts.findFirst({ select: { name: true, email: true, phone: true, company: true }, where: { id: contactId } }),
      db.pipelines.findMany({
        select: { id: true, name: true, key: true, pipeline_stages: { select: { id: true, name: true, position: true, ai_hint: true } } },
        orderBy: { created_at: 'asc' },
      }),
      db.tags.findMany({ select: { id: true, name: true, ai_hint: true }, orderBy: { created_at: 'asc' }, take: 60 }),
      db.contact_tags.findMany({ select: { tag_id: true }, where: { contact_id: contactId } }),
      db.custom_fields.findMany({ select: { id: true, field_name: true, field_type: true, field_options: true, key: true }, orderBy: { created_at: 'asc' }, take: 40 }),
      db.contact_custom_values.findMany({ select: { custom_field_id: true, value: true }, where: { contact_id: contactId } }),
    ])
    if (!contact) return null
    const usable = pipelines.filter((p) => p.key !== 'real_estate')
    const allStages = usable.flatMap((p) => p.pipeline_stages.map((s) => ({ id: s.id, pipeline_id: p.id, position: s.position, name: s.name })))
    const stages = usable.flatMap((p) =>
      p.pipeline_stages
        .filter((s) => s.ai_hint?.trim())
        .sort((a, b) => a.position - b.position)
        .map((s) => ({ id: s.id, pipeline_id: p.id, pipeline_name: p.name, name: s.name, position: s.position, ai_hint: s.ai_hint!.trim() })),
    )
    const deals = stages.length
      ? await db.deals.findMany({
          select: { id: true, pipeline_id: true, stage_id: true, title: true, value: true },
          where: { contact_id: contactId, status: 'open', pipeline_id: { in: usable.map((p) => p.id) } },
          orderBy: { created_at: 'desc' },
          take: 10,
        })
      : []
    return {
      stages,
      allStages,
      deals: deals.map((d) => ({ ...d, value: Number(d.value) })),
      tags,
      tagIds: tagLinks.map((t) => t.tag_id),
      fields,
      values: Object.fromEntries(values.filter((v) => v.value).map((v) => [v.custom_field_id, v.value!])),
      contact,
      dealsManaged: industry === 'real_estate',
    }
  } catch (err) {
    console.error('[ai-crm] context failed:', err instanceof Error ? err.message : err)
    return null
  }
}

/** Upserts one custom value (the inbox's PUT replaces all of them; the AI only touches its own). */
async function setCustomValue(workspaceId: string, contactId: string, fieldId: string, value: string) {
  const db = tenantDb(workspaceId)
  const { count } = await db.contact_custom_values.updateMany({ where: { contact_id: contactId, custom_field_id: fieldId }, data: { value } })
  if (!count) await db.contact_custom_values.create({ data: { workspace_id: workspaceId, contact_id: contactId, custom_field_id: fieldId, value } })
}

/** "Más información del cliente": created the first time something goes there. */
async function extraInfoField(workspaceId: string, lang: 'es' | 'en'): Promise<string> {
  const db = tenantDb(workspaceId)
  const found = await db.custom_fields.findFirst({ select: { id: true }, where: { key: EXTRA_INFO_KEY } })
  if (found) return found.id
  try {
    const row = await db.custom_fields.create({
      select: { id: true },
      data: { workspace_id: workspaceId, key: EXTRA_INFO_KEY, field_name: EXTRA_INFO_NAME[lang], field_type: 'text', user_id: null },
    })
    return row.id
  } catch {
    // Created at the same time by another turn.
    const again = await db.custom_fields.findFirstOrThrow({ select: { id: true }, where: { key: EXTRA_INFO_KEY } })
    return again.id
  }
}

export interface ApplyCrmInput {
  workspaceId: string
  contactId: string
  conversationId: string
  lang: 'es' | 'en'
  timeZone: string
  currency: string
  crm: CrmOutput | undefined
  ctx: CrmContext
  /** The turn handed the chat to a person: the summary note is written. */
  handover: boolean
}

/** Writes what the model asked for and charges one 'crm_action' per action written. Returns what was done. */
export async function applyAiCrm(input: ApplyCrmInput): Promise<CrmAction[]> {
  const out = input.crm
  if (!out || typeof out !== 'object') return []
  const { workspaceId, contactId, conversationId, ctx } = input
  const done: CrmAction[] = []
  try {
    const contact = planContact(out.contact, ctx, input.lang)
    const deal = planDeal(out, ctx)
    const tags = planTags(out, ctx)
    const task = planTask(out, (d, t) => {
      try {
        return zonedTimeToUtc(d, t, input.timeZone)
      } catch {
        return null
      }
    })
    const summary = input.handover && typeof out.summary === 'string' ? out.summary.trim().slice(0, 1500) : ''
    const anything = contact.changed.length || contact.extra.length || deal.kind !== 'none' || tags.length || task || summary
    if (!anything) return []
    // Out of credits: the AI keeps answering (already paid) but writes nothing.
    if (!(await canSpend(workspaceId, 'crm_action'))) return []

    const db = tenantDb(workspaceId)
    const today = zonedNow(input.timeZone).date

    // 1) Customer data.
    if (contact.changed.length || contact.extra.length) {
      if (Object.keys(contact.patch).length) {
        await db.contacts.updateMany({ where: { id: contactId }, data: { ...contact.patch, updated_at: new Date() } })
      }
      for (const [fieldId, value] of Object.entries(contact.fields)) await setCustomValue(workspaceId, contactId, fieldId, value)
      let extraSaved = false
      if (contact.extra.length) {
        const fieldId = await extraInfoField(workspaceId, input.lang)
        const cur = await db.contact_custom_values.findFirst({ select: { value: true }, where: { contact_id: contactId, custom_field_id: fieldId } })
        const next = appendExtraInfo(cur?.value, contact.extra, today)
        if (next !== null) {
          await setCustomValue(workspaceId, contactId, fieldId, next)
          extraSaved = true
        }
      }
      const changed = [...contact.changed, ...(extraSaved ? [EXTRA_INFO_NAME[input.lang]] : [])]
      if (changed.length) done.push({ kind: 'contact', changed })
    }

    // 2) Deal: opened at, or moved forward to, the stage the conversation fits.
    if (deal.kind === 'create') {
      const row = await db.deals.create({
        select: { id: true },
        data: {
          workspace_id: workspaceId,
          pipeline_id: deal.stage.pipeline_id,
          stage_id: deal.stage.id,
          contact_id: contactId,
          conversation_id: conversationId,
          title: deal.title,
          value: deal.value,
          currency: input.currency,
          user_id: null,
        },
      })
      done.push({ kind: 'deal_created', stage: deal.stage.name, dealId: row.id })
    } else if (deal.kind === 'move') {
      await db.deals.updateMany({
        where: { id: deal.deal.id, status: 'open' },
        data: { stage_id: deal.stage.id, updated_at: new Date(), ...(deal.value ? { value: deal.value } : {}) },
      })
      done.push({ kind: 'deal_moved', stage: deal.stage.name, dealId: deal.deal.id })
    }

    // 3) Tags.
    for (const tag of tags) {
      await db.contact_tags.create({ data: { workspace_id: workspaceId, contact_id: contactId, tag_id: tag.id } })
      done.push({ kind: 'tag', tag: tag.name })
    }

    // 4) Task for the team, on whoever has the chat.
    if (task) {
      const dup = await db.tasks.count({ where: { contact_id: contactId, status: 'open', title: task.title } })
      if (!dup) {
        const conv = await db.conversations.findFirst({ select: { assigned_agent_id: true }, where: { id: conversationId } })
        const dealId = done.find((a): a is Extract<CrmAction, { dealId?: string }> => 'dealId' in a && !!a.dealId)?.dealId ?? ctx.deals[0]?.id ?? null
        await db.tasks.create({
          data: {
            workspace_id: workspaceId,
            title: task.title,
            description: task.notes,
            due_at: task.due,
            assignee_user_id: conv?.assigned_agent_id ?? null,
            contact_id: contactId,
            conversation_id: conversationId,
            deal_id: dealId,
            created_by: null,
          },
        })
        done.push({ kind: 'task', title: task.title })
      }
    }

    // 5) Summary note when the chat goes to a person.
    if (summary) {
      await db.contact_notes.create({ data: { workspace_id: workspaceId, contact_id: contactId, user_id: null, note_text: `[IA] ${summary}` } })
      done.push({ kind: 'note' })
    }

    if (done.length) {
      await spend(workspaceId, 'crm_action', { conversationId, times: done.length })
      await recordEvent({
        workspaceId,
        conversationId,
        type: 'ai_crm',
        note: describeActions(done, input.lang),
        data: { actions: done.map(({ kind, ...rest }) => ({ kind, ...('dealId' in rest ? { stage: (rest as { stage: string }).stage } : rest) })) },
      })
    }
  } catch (err) {
    console.error('[ai-crm] apply failed:', err instanceof Error ? err.message : err)
    if (done.length) await spend(workspaceId, 'crm_action', { conversationId, times: done.length })
  }
  return done
}
