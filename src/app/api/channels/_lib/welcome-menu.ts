import type { WelcomeMenu, WelcomeMenuOption } from '@/lib/ai/types'

// Validation of channels.settings.welcome_menu (all channel types).
// Limits follow WhatsApp interactive messages: ≤3 options are sent as
// reply buttons (title ≤20), more as a list (row title ≤24, description
// ≤72, ≤10 rows). Other channels adapt the same menu.

export const WELCOME_MENU_LIMITS = {
  maxOptions: 10,
  maxButtons: 3,
  buttonTitle: 20,
  listTitle: 24,
  description: 72,
  question: 1024,
  buttonLabel: 20,
  id: 32,
} as const

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/

/** Short stable slug for an option id ("Soporte técnico" → "soporte_tecnico"). */
export function optionSlug(label: string): string {
  return (
    label
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'opcion'
  )
}

export type ParsedWelcomeMenu =
  | { ok: true; menu: WelcomeMenu | null; agentIds: string[]; assigneeIds: string[] }
  | { ok: false; error: string }

/** Shape/limits check. `null` removes the menu. DB references are checked by the caller. */
export function parseWelcomeMenu(input: unknown): ParsedWelcomeMenu {
  if (input === null) return { ok: true, menu: null, agentIds: [], assigneeIds: [] }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, error: 'welcome_menu must be an object or null' }
  const src = input as Record<string, unknown>
  const L = WELCOME_MENU_LIMITS

  const enabled = src.enabled === true
  const question = typeof src.question === 'string' ? src.question.trim() : ''
  if (question.length > L.question) return { ok: false, error: `welcome_menu.question is over ${L.question} characters` }
  const buttonLabel = typeof src.button_label === 'string' ? src.button_label.trim() : ''
  if (buttonLabel.length > L.buttonLabel) return { ok: false, error: `welcome_menu.button_label is over ${L.buttonLabel} characters` }

  if (src.options !== undefined && !Array.isArray(src.options)) return { ok: false, error: 'welcome_menu.options must be an array' }
  const rawOptions = (src.options as unknown[] | undefined) ?? []
  if (rawOptions.length > L.maxOptions) return { ok: false, error: `welcome_menu allows at most ${L.maxOptions} options` }
  const titleMax = rawOptions.length <= L.maxButtons ? L.buttonTitle : L.listTitle

  const options: WelcomeMenuOption[] = []
  const ids = new Set<string>()
  const agentIds = new Set<string>()
  const assigneeIds = new Set<string>()
  for (let i = 0; i < rawOptions.length; i++) {
    const n = i + 1
    const o = rawOptions[i]
    if (!o || typeof o !== 'object') return { ok: false, error: `Option ${n} is invalid` }
    const opt = o as Record<string, unknown>
    const label = typeof opt.label === 'string' ? opt.label.trim() : ''
    if (!label) return { ok: false, error: `Option ${n} needs a label` }
    if (label.length > titleMax) return { ok: false, error: `Option ${n} label is over ${titleMax} characters` }
    const description = typeof opt.description === 'string' ? opt.description.trim() : ''
    if (description.length > L.description) return { ok: false, error: `Option ${n} description is over ${L.description} characters` }

    let id = typeof opt.id === 'string' && opt.id.trim() ? opt.id.trim() : optionSlug(label)
    if (!ID_RE.test(id)) return { ok: false, error: `Option ${n} id must be a short slug (a-z, 0-9, _ or -)` }
    if (ids.has(id)) {
      if (typeof opt.id === 'string' && opt.id.trim()) return { ok: false, error: `Duplicate option id "${id}"` }
      let k = 2
      while (ids.has(`${id.slice(0, 28)}_${k}`)) k++
      id = `${id.slice(0, 28)}_${k}`
    }
    ids.add(id)

    const target = opt.target as Record<string, unknown> | undefined
    let parsedTarget: WelcomeMenuOption['target']
    if (target?.type === 'agent') {
      if (typeof target.agent_id !== 'string' || !target.agent_id) return { ok: false, error: `Option ${n} needs an AI agent` }
      parsedTarget = { type: 'agent', agent_id: target.agent_id }
      agentIds.add(target.agent_id)
    } else if (target?.type === 'human') {
      const assignee = typeof target.assignee_user_id === 'string' && target.assignee_user_id ? target.assignee_user_id : null
      parsedTarget = { type: 'human', assignee_user_id: assignee }
      if (assignee) assigneeIds.add(assignee)
    } else {
      return { ok: false, error: `Option ${n} target must be an AI agent or the human team` }
    }

    options.push({ id, label, ...(description ? { description } : {}), target: parsedTarget })
  }

  if (enabled && !question) return { ok: false, error: 'welcome_menu.question is required when the menu is enabled' }
  if (enabled && options.length === 0) return { ok: false, error: 'welcome_menu needs at least one option when enabled' }

  const menu: WelcomeMenu = { enabled, question, options, ...(buttonLabel ? { button_label: buttonLabel } : {}) }
  return { ok: true, menu, agentIds: [...agentIds], assigneeIds: [...assigneeIds] }
}
