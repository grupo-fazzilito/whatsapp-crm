import type { AutomationTriggerType } from '@/types'
import type { Translator } from '@/i18n/translate'

export interface TriggerMeta {
  label: string
  /** Translation key; UI prefers it over `label` (English fallback). */
  i18nKey?: string
  /** Tailwind classes for the Badge pill on the list row. */
  pillClass: string
}

export const TRIGGER_META: Record<AutomationTriggerType, TriggerMeta> = {
  new_message_received: {
    label: 'New Message',
    i18nKey: 'automations.triggers.new_message_received.pill',
    pillClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  first_inbound_message: {
    label: 'First Message from Contact',
    i18nKey: 'automations.triggers.first_inbound_message.pill',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  keyword_match: {
    label: 'Keyword Match',
    i18nKey: 'automations.triggers.keyword_match.pill',
    pillClass: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
  new_contact_created: {
    label: 'New Contact',
    i18nKey: 'automations.triggers.new_contact_created.pill',
    pillClass: 'border-primary/30 bg-primary/10 text-primary',
  },
  conversation_assigned: {
    label: 'Conversation Assigned',
    i18nKey: 'automations.triggers.conversation_assigned.pill',
    pillClass: 'border-teal-500/30 bg-teal-500/10 text-teal-300',
  },
  tag_added: {
    label: 'Tag Added',
    i18nKey: 'automations.triggers.tag_added.pill',
    pillClass: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  time_based: {
    label: 'Time-Based',
    i18nKey: 'automations.triggers.time_based.pill',
    pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
  },
  no_reply: {
    label: 'No reply (follow-up)',
    i18nKey: 'followups.trigger.pill',
    pillClass: 'border-violet-500/30 bg-violet-500/10 text-violet-300',
  },
}

export function triggerMeta(t: AutomationTriggerType | string): TriggerMeta {
  return (
    TRIGGER_META[t as AutomationTriggerType] ?? {
      label: t,
      pillClass: 'border-slate-500/30 bg-slate-500/10 text-slate-300',
    }
  )
}

/**
 * "5 min ago"-style relative time in the UI language. `t` is the
 * translator from `useT()`; `locale` formats dates older than 30 days.
 */
export function formatRelative(
  iso: string | null | undefined,
  t: Translator,
  locale?: string,
): string {
  if (!iso) return t('automations.relative.never')
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return t('automations.relative.never')
  const diffSec = Math.round((Date.now() - then) / 1000)
  if (diffSec < 60) return t('automations.relative.justNow')
  if (diffSec < 3600) return t('automations.relative.minutesAgo', { n: Math.floor(diffSec / 60) })
  if (diffSec < 86400) return t('automations.relative.hoursAgo', { n: Math.floor(diffSec / 3600) })
  if (diffSec < 2_592_000) return t('automations.relative.daysAgo', { n: Math.floor(diffSec / 86400) })
  return new Date(iso).toLocaleDateString(locale)
}

/** Translated trigger pill label, falling back to the English `label`. */
export function triggerPillLabel(type: AutomationTriggerType | string, t: Translator): string {
  const meta = triggerMeta(type)
  if (!meta.i18nKey) return meta.label
  const out = t(meta.i18nKey)
  return out === meta.i18nKey ? meta.label : out
}
