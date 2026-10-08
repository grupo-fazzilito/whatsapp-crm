import type { AutomationTriggerType } from '@/types'
import type { ChannelType } from '@/lib/channels/types'
import { CHANNEL_CAPABILITIES } from '@/lib/channels/capabilities'
import { delayHours, normalizeNoReplyConfig, supportsTemplates } from './followup-rules'

// ------------------------------------------------------------
// Pre-flight config validation for automations about to be activated.
//
// Activating a broken automation (e.g. an add_tag step with tag_id="")
// used to succeed silently — every trigger then produced a failed log
// row with a cryptic "add_tag needs contact + tag_id" message, and
// users often didn't notice until reviewing logs. This module lets
// the API refuse activation with a useful 400 response instead.
//
// The rules here mirror the runtime checks in engine.ts's runStep;
// they're the same invariants, enforced one step earlier so failures
// surface at save time.
// ------------------------------------------------------------

export interface ValidationIssue {
  /** Dot-path for the UI to highlight; stable enough to build a table. */
  path: string
  message: string
  /** Stable id for the UI to translate (newer rules only). */
  code?: string
  params?: Record<string, string | number>
  /** Warnings never block activation. Missing = error. */
  severity?: 'error' | 'warning'
}

interface StepLike {
  step_type: string
  step_config: Record<string, unknown>
  branches?: { yes?: StepLike[]; no?: StepLike[] }
}

export function validateStepsForActivation(steps: StepLike[]): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  if (!Array.isArray(steps) || steps.length === 0) {
    issues.push({
      path: 'steps',
      message: 'active automations need at least one step',
    })
    return issues
  }
  walk(steps, '', issues)
  return issues
}

function walk(steps: StepLike[], prefix: string, issues: ValidationIssue[]): void {
  steps.forEach((s, i) => {
    const path = `${prefix}steps[${i}]`
    validateOne(s, path, issues)
    if (s.step_type === 'condition' && s.branches) {
      if (s.branches.yes) walk(s.branches.yes, `${path}.yes.`, issues)
      if (s.branches.no) walk(s.branches.no, `${path}.no.`, issues)
    }
  })
}

function validateOne(step: StepLike, path: string, issues: ValidationIssue[]): void {
  const c = step.step_config ?? {}
  switch (step.step_type) {
    case 'send_message':
      if (!nonEmpty(c.text)) {
        issues.push({ path: `${path}.text`, message: 'message text is required' })
      }
      break
    case 'send_template':
      if (!nonEmpty(c.template_name)) {
        issues.push({ path: `${path}.template_name`, message: 'template name is required' })
      }
      break
    case 'add_tag':
    case 'remove_tag':
      if (!nonEmpty(c.tag_id)) {
        issues.push({ path: `${path}.tag_id`, message: 'tag is required' })
      }
      break
    case 'assign_conversation':
      if (c.mode === 'specific' && !nonEmpty(c.agent_id)) {
        issues.push({
          path: `${path}.agent_id`,
          message: 'agent is required when mode is "specific"',
        })
      }
      break
    case 'update_contact_field':
      if (!nonEmpty(c.field)) {
        issues.push({ path: `${path}.field`, message: 'field name is required' })
      }
      if (c.value === undefined || c.value === null || c.value === '') {
        issues.push({ path: `${path}.value`, message: 'field value is required' })
      }
      break
    case 'create_deal':
      if (!nonEmpty(c.pipeline_id)) {
        issues.push({ path: `${path}.pipeline_id`, message: 'pipeline is required' })
      }
      if (!nonEmpty(c.stage_id)) {
        issues.push({ path: `${path}.stage_id`, message: 'stage is required' })
      }
      if (!nonEmpty(c.title)) {
        issues.push({ path: `${path}.title`, message: 'title is required' })
      }
      break
    case 'wait':
      if (typeof c.amount !== 'number' || !Number.isFinite(c.amount) || c.amount <= 0) {
        issues.push({ path: `${path}.amount`, message: 'wait amount must be greater than 0' })
      }
      if (!['minutes', 'hours', 'days'].includes(String(c.unit))) {
        issues.push({
          path: `${path}.unit`,
          message: 'wait unit must be minutes, hours, or days',
        })
      }
      break
    case 'condition':
      if (!nonEmpty(c.subject)) {
        issues.push({ path: `${path}.subject`, message: 'condition subject is required' })
      }
      if (!nonEmpty(c.operand)) {
        issues.push({ path: `${path}.operand`, message: 'condition operand is required' })
      }
      break
    case 'send_webhook':
      if (!nonEmpty(c.url)) {
        issues.push({ path: `${path}.url`, message: 'webhook URL is required' })
        break
      }
      try {
        const u = new URL(String(c.url))
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          issues.push({
            path: `${path}.url`,
            message: 'webhook URL must use http or https',
          })
        }
      } catch {
        issues.push({ path: `${path}.url`, message: 'webhook URL is not a valid URL' })
      }
      break
    case 'close_conversation':
      // No config required.
      break
    case 'ai_followup':
      if (c.agent_id !== undefined && c.agent_id !== null && typeof c.agent_id !== 'string') {
        issues.push({ path: `${path}.agent_id`, message: 'agent must be an id', code: 'ai_followup_agent' })
      }
      if (typeof c.instructions === 'string' && c.instructions.length > 1000) {
        issues.push({
          path: `${path}.instructions`,
          message: 'instructions are too long (max 1000 characters)',
          code: 'ai_followup_instructions_long',
        })
      }
      break
    default:
      issues.push({ path, message: `unknown step type: ${step.step_type}` })
  }
}

export function validateTriggerForActivation(
  triggerType: AutomationTriggerType | string,
  triggerConfig: unknown,
): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const cfg = (triggerConfig ?? {}) as Record<string, unknown>

  if (triggerType === 'keyword_match') {
    const k = cfg.keywords
    if (!Array.isArray(k) || k.length === 0) {
      issues.push({ path: 'trigger.keywords', message: 'at least one keyword is required' })
    } else if (k.some((v) => typeof v !== 'string' || v.trim() === '')) {
      issues.push({ path: 'trigger.keywords', message: 'keywords cannot be empty strings' })
    }
    if (cfg.match_type !== 'exact' && cfg.match_type !== 'contains') {
      issues.push({
        path: 'trigger.match_type',
        message: 'match type must be "exact" or "contains"',
      })
    }
  } else if (triggerType === 'time_based') {
    if (!nonEmpty(cfg.schedule)) {
      issues.push({ path: 'trigger.schedule', message: 'schedule is required' })
    }
  } else if (triggerType === 'tag_added') {
    if (!nonEmpty(cfg.tag_id)) {
      issues.push({ path: 'trigger.tag_id', message: 'tag is required' })
    }
  } else if (triggerType === 'no_reply') {
    const after = (cfg.after ?? {}) as Record<string, unknown>
    if (typeof after.amount !== 'number' || !Number.isFinite(after.amount) || after.amount <= 0) {
      issues.push({ path: 'trigger.after.amount', message: 'delay must be greater than 0', code: 'no_reply_amount' })
    }
    if (!['minutes', 'hours', 'days'].includes(String(after.unit))) {
      issues.push({ path: 'trigger.after.unit', message: 'delay unit must be minutes, hours, or days', code: 'no_reply_unit' })
    } else if (delayHours(after) > MAX_NO_REPLY_HOURS) {
      issues.push({ path: 'trigger.after', message: 'delay cannot exceed 30 days', code: 'no_reply_too_long' })
    }
    if (cfg.channel_ids !== undefined && (!Array.isArray(cfg.channel_ids) || cfg.channel_ids.some((v) => typeof v !== 'string'))) {
      issues.push({ path: 'trigger.channel_ids', message: 'channels must be a list of ids', code: 'no_reply_channels' })
    }
    if (cfg.only_when_ai === true && cfg.only_when_human === true) {
      issues.push({
        path: 'trigger.only_when_ai',
        message: 'choose "only AI" or "only human", not both',
        code: 'no_reply_both_filters',
      })
    }
  }

  return issues
}

const MAX_NO_REPLY_HOURS = 30 * 24

// ------------------------------------------------------------
// Channel rules: messaging windows and templates.
//
// WhatsApp / Instagram / Messenger only accept free-form messages within
// 24 h of the customer's last message (TikTok: 48 h); outside it only
// approved templates work, and templates only exist on WhatsApp.
//
// For each free-form send we compute a LOWER BOUND of the time since the
// customer last wrote: the no_reply delay (the customer has been silent
// at least that long) plus every wait before the step. When that bound
// reaches a channel's window the send can never succeed there:
//   - every targeted channel closed → error (blocks activation);
//   - only some of them            → warning.
// ------------------------------------------------------------

export interface ChannelRef {
  id: string
  type: ChannelType
}

export function validateChannelRules(input: {
  triggerType: AutomationTriggerType | string
  triggerConfig: unknown
  steps: StepLike[]
  /** Channels of the workspace. */
  channels: ChannelRef[]
}): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const types = targetChannelTypes(input.triggerType, input.triggerConfig, input.channels)
  const base = input.triggerType === 'no_reply' ? delayHours(normalizeNoReplyConfig(input.triggerConfig).after) : 0

  const checkFreeForm = (path: string, elapsed: number) => {
    if (types.length === 0) {
      if (elapsed >= 24) {
        issues.push({
          path,
          message: 'free-form messages need the customer to have written in the last 24 h; use a template',
          code: 'window_closed_some',
          params: { hours: Math.round(elapsed), channels: 'WhatsApp, Instagram, Messenger' },
          severity: 'warning',
        })
      }
      return
    }
    const closed = types.filter((t) => {
      const h = CHANNEL_CAPABILITIES[t].replyWindowHours
      return h !== null && elapsed >= h
    })
    if (closed.length === 0) return
    const all = closed.length === types.length
    issues.push({
      path,
      message: all
        ? `the messaging window is always closed at this point (customer silent ≥ ${Math.round(elapsed)} h); use a template`
        : `the messaging window is closed at this point on ${closed.join(', ')}; use a template there`,
      code: all ? 'window_closed' : 'window_closed_some',
      params: { hours: Math.round(elapsed), channels: closed.map(channelName).join(', ') },
      severity: all ? 'error' : 'warning',
    })
  }

  const checkTemplate = (path: string) => {
    if (types.length === 0) return
    const ok = types.filter((t) => supportsTemplates(t))
    if (ok.length === types.length) return
    const bad = types.filter((t) => !supportsTemplates(t))
    issues.push({
      path,
      message: ok.length === 0 ? 'templates only work on WhatsApp channels' : `templates do not work on ${bad.join(', ')}`,
      code: ok.length === 0 ? 'template_whatsapp_only' : 'template_some_channels',
      params: { channels: bad.map(channelName).join(', ') },
      severity: ok.length === 0 ? 'error' : 'warning',
    })
  }

  const walkWindow = (steps: StepLike[], prefix: string, start: number) => {
    let elapsed = start
    steps.forEach((s, i) => {
      const path = `${prefix}steps[${i}]`
      const c = s.step_config ?? {}
      if (s.step_type === 'wait') elapsed += delayHours(c as { amount?: unknown; unit?: unknown })
      else if (s.step_type === 'send_message' || s.step_type === 'ai_followup') checkFreeForm(path, elapsed)
      else if (s.step_type === 'send_template') checkTemplate(path)
      else if (s.step_type === 'condition' && s.branches) {
        // A wait inside a branch only delays that branch (engine semantics).
        if (s.branches.yes) walkWindow(s.branches.yes, `${path}.yes.`, elapsed)
        if (s.branches.no) walkWindow(s.branches.no, `${path}.no.`, elapsed)
      }
    })
  }

  if (Array.isArray(input.steps)) walkWindow(input.steps, '', base)
  return issues
}

/** Splits issues into blocking errors and warnings. */
export function partitionIssues(issues: ValidationIssue[]): { errors: ValidationIssue[]; warnings: ValidationIssue[] } {
  return {
    errors: issues.filter((i) => i.severity !== 'warning'),
    warnings: issues.filter((i) => i.severity === 'warning'),
  }
}

function targetChannelTypes(triggerType: string, triggerConfig: unknown, channels: ChannelRef[]): ChannelType[] {
  let pool = channels
  if (triggerType === 'no_reply') {
    const ids = normalizeNoReplyConfig(triggerConfig).channel_ids ?? []
    if (ids.length) pool = channels.filter((c) => ids.includes(c.id))
  }
  return [...new Set(pool.map((c) => c.type))]
}

function channelName(t: ChannelType): string {
  return { whatsapp: 'WhatsApp', instagram: 'Instagram', messenger: 'Messenger', tiktok: 'TikTok', webchat: 'Web chat' }[t] ?? t
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0
}
