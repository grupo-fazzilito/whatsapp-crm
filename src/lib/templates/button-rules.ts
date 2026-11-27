// What the AI agent does when a customer presses a quick-reply button of a
// WhatsApp template (pure: no database). Stored per template as
// { "<button text>": "<rule>" }, apart from the buttons Meta reviews.

export const BUTTON_RULE_MAX = 1000

export type ButtonRules = Record<string, string>

const key = (s: string) => s.trim().toLowerCase()

/** Keeps a rule only for the template's quick-reply buttons, trimmed; empty ones are dropped. */
export function parseButtonRules(input: unknown, buttons: readonly { type: string; text: string }[]): ButtonRules | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  const quick = buttons.filter((b) => b.type === 'quick_reply' && b.text.trim())
  const out: ButtonRules = {}
  for (const [text, rule] of Object.entries(input as Record<string, unknown>)) {
    if (typeof rule !== 'string') return null
    const button = quick.find((b) => key(b.text) === key(text))
    const value = rule.trim().slice(0, BUTTON_RULE_MAX)
    if (button && value) out[button.text.trim()] = value
  }
  return out
}

/** The rule for a pressed button (WhatsApp sends its text), if the template has one. */
export function ruleForButton(rules: unknown, pressed: string): { button: string; rule: string } | null {
  if (!rules || typeof rules !== 'object' || !pressed.trim()) return null
  for (const [button, rule] of Object.entries(rules as Record<string, unknown>)) {
    if (typeof rule === 'string' && rule.trim() && key(button) === key(pressed)) return { button, rule: rule.trim() }
  }
  return null
}
