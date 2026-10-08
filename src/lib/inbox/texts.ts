// Notification texts, written in the workspace's language when the
// notification is created (they are stored, not re-translated).

type Lang = 'es' | 'en'

const TEXT = {
  es: {
    mention: '{actor} te mencionó en una nota',
    assigned: '{actor} te asignó una conversación',
    autoAssigned: 'Se te asignó una conversación nueva',
    transferred: '{actor} te transfirió una conversación',
    teamTransferred: '{actor} transfirió una conversación al equipo {team}',
    someone: 'Alguien',
    customer: 'Cliente',
  },
  en: {
    mention: '{actor} mentioned you in a note',
    assigned: '{actor} assigned you a conversation',
    autoAssigned: 'A new conversation was assigned to you',
    transferred: '{actor} transferred a conversation to you',
    teamTransferred: '{actor} transferred a conversation to the {team} team',
    someone: 'Someone',
    customer: 'Customer',
  },
} as const

export type NotificationTextKey = keyof (typeof TEXT)['es']

export function notificationText(
  locale: string | null | undefined,
  key: NotificationTextKey,
  vars: Record<string, string> = {},
): string {
  const lang: Lang = locale === 'en' ? 'en' : 'es'
  return TEXT[lang][key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '')
}

/** One-line preview for a notification body. */
export function snippet(text: string | null | undefined, max = 140): string {
  const t = (text ?? '').replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}
