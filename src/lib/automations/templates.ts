import type {
  AutomationStepConfig,
  AutomationStepType,
  AutomationTriggerConfig,
  AutomationTriggerType,
} from '@/types'
import type { Translator } from '@/i18n/translate'

export type TemplateSlug =
  | 'welcome_message'
  | 'out_of_office'
  | 'lead_qualifier'
  | 'followup_no_reply_2h'
  | 'followup_last_call_23h'
  | 'followup_winback_3d'
  | 'appointment_booking'

export interface TemplateStepSeed {
  step_type: AutomationStepType
  step_config: AutomationStepConfig
  branch?: 'yes' | 'no' | null
  /** Index (within this seed list) of the Condition parent, if nested. */
  parent_index?: number | null
}

export interface AutomationTemplateDefinition {
  slug: TemplateSlug
  name: string
  description: string
  trigger_type: AutomationTriggerType
  trigger_config: AutomationTriggerConfig
  steps: TemplateStepSeed[]
}

export const AUTOMATION_TEMPLATES: Record<TemplateSlug, AutomationTemplateDefinition> = {
  welcome_message: {
    slug: 'welcome_message',
    name: 'Welcome Message',
    description: 'Auto-reply to first-time contacts with a greeting.',
    // first_inbound_message (added in PR #33) catches both brand-new
    // contacts AND manually-added/imported contacts on their first-ever
    // reply, which is what a user setting up a "welcome" automation
    // almost always wants. new_contact_created would miss the
    // manually-imported case.
    trigger_type: 'first_inbound_message',
    trigger_config: {},
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: "Hi! 👋 Thanks for reaching out. We'll get back to you shortly.",
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
    ],
  },
  out_of_office: {
    slug: 'out_of_office',
    name: 'Out of Office',
    description: 'Auto-reply during off-hours so nobody is left waiting.',
    trigger_type: 'new_message_received',
    trigger_config: {},
    steps: [
      {
        step_type: 'condition',
        step_config: {
          subject: 'time_of_day',
          operand: '18:00-09:00',
        },
      },
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Thanks for your message! Our team is offline right now (9am–6pm) and will reply first thing tomorrow.",
        },
        parent_index: 0,
        branch: 'yes',
      },
    ],
  },
  lead_qualifier: {
    slug: 'lead_qualifier',
    name: 'Lead Qualifier',
    description: 'Ask qualification questions to filter inbound leads.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['pricing', 'quote', 'buy'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Great — happy to help with pricing! Quick question: roughly how many seats are you looking for?",
        },
      },
      {
        step_type: 'wait',
        step_config: { amount: 10, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
  // "Seguimientos": no_reply fires when WE spoke last and the customer
  // stayed silent for `after`; any customer message cancels it.
  followup_no_reply_2h: {
    slug: 'followup_no_reply_2h',
    name: 'Seguimiento sin respuesta (2 h)',
    description: 'Si el cliente no responde en 2 horas, le escribimos para retomar la conversación.',
    trigger_type: 'no_reply',
    trigger_config: { after: { amount: 2, unit: 'hours' }, channel_ids: [] },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text: '¡Hola! 👋 ¿Pudiste revisar lo que te comentamos? Si tienes alguna duda, aquí estoy para ayudarte.',
        },
      },
    ],
  },
  followup_last_call_23h: {
    slug: 'followup_last_call_23h',
    name: 'Último aviso antes de 24 h',
    description:
      'A las 23 h sin respuesta, la IA escribe un último mensaje antes de que se cierre la ventana de 24 h de WhatsApp.',
    trigger_type: 'no_reply',
    trigger_config: { after: { amount: 23, unit: 'hours' }, channel_ids: [] },
    steps: [
      {
        step_type: 'ai_followup',
        step_config: {
          instructions:
            'Es el último mensaje que podemos enviar antes de que se cierre la conversación. Retoma lo que el cliente necesitaba y pregúntale si quiere continuar.',
        },
      },
    ],
  },
  followup_winback_3d: {
    slug: 'followup_winback_3d',
    name: 'Recuperar cliente (3 días, plantilla)',
    description:
      'Tras 3 días sin respuesta la ventana de 24 h ya está cerrada: enviamos una plantilla aprobada de WhatsApp.',
    trigger_type: 'no_reply',
    trigger_config: { after: { amount: 3, unit: 'days' }, channel_ids: [] },
    steps: [
      {
        step_type: 'send_template',
        step_config: { template_name: '', language: 'es' },
      },
    ],
  },
  appointment_booking: {
    slug: 'appointment_booking',
    name: 'Doctor Appointment Booking',
    description: 'Auto-reply to patient booking requests and route them to your clinic staff.',
    trigger_type: 'keyword_match',
    trigger_config: {
      keywords: ['book', 'appointment', 'doctor', 'slot', 'clinic', 'visit', 'checkup'],
      match_type: 'contains',
    },
    steps: [
      {
        step_type: 'send_message',
        step_config: {
          text:
            "Hello! 🏥 Thank you for contacting our clinic. To request an appointment, please reply with:\n\n1. Patient's Full Name\n2. Preferred Specialty / Doctor\n3. Preferred Date & Time\n\nYou can also view our schedule and book directly here: https://example.com/booking",
        },
      },
      {
        step_type: 'add_tag',
        step_config: { tag_id: '' },
      },
      {
        step_type: 'wait',
        step_config: { amount: 15, unit: 'minutes' },
      },
      {
        step_type: 'assign_conversation',
        step_config: { mode: 'round_robin' },
      },
    ],
  },
}

export function getTemplate(slug: string): AutomationTemplateDefinition | null {
  return AUTOMATION_TEMPLATES[slug as TemplateSlug] ?? null
}

/** Translated text for `automations.templates.<slug>.<field>`, or `fallback` when the key is missing. */
function templateString(slug: TemplateSlug, field: string, t: Translator, fallback: string): string {
  const key = `automations.templates.${slug}.${field}`
  const out = t(key)
  return out === key ? fallback : out
}

/** Template name/description in the UI language (English fallback from the definition). */
export function templateLabels(
  slug: TemplateSlug,
  t: Translator,
): { name: string; description: string } {
  const def = AUTOMATION_TEMPLATES[slug]
  return {
    name: templateString(slug, 'name', t, def.name),
    description: templateString(slug, 'description', t, def.description),
  }
}

/**
 * The template with its customer-facing text (message, AI instructions,
 * keywords) in the language of `t` — pass a translator for the workspace
 * locale so customers get messages in the business's language.
 */
export function localizedTemplate(
  slug: TemplateSlug,
  t: Translator,
): AutomationTemplateDefinition {
  const def = AUTOMATION_TEMPLATES[slug]
  const triggerConfig = def.trigger_config as Record<string, unknown>
  const keywords = Array.isArray(triggerConfig.keywords)
    ? templateString(slug, 'keywords', t, (triggerConfig.keywords as string[]).join(', '))
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
    : undefined
  return {
    ...def,
    trigger_config: (keywords
      ? { ...triggerConfig, keywords }
      : def.trigger_config) as unknown as AutomationTriggerConfig,
    steps: def.steps.map((seed) => {
      const cfg = seed.step_config as Record<string, unknown>
      if (seed.step_type === 'send_message' && typeof cfg.text === 'string') {
        return { ...seed, step_config: { ...cfg, text: templateString(slug, 'message', t, cfg.text) } as unknown as AutomationStepConfig }
      }
      if (seed.step_type === 'ai_followup' && typeof cfg.instructions === 'string') {
        return {
          ...seed,
          step_config: { ...cfg, instructions: templateString(slug, 'instructions', t, cfg.instructions) } as unknown as AutomationStepConfig,
        }
      }
      return seed
    }),
  }
}
