// One message → one row of the conversations backup (pure: no database).

export type BackupLang = 'es' | 'en'

export interface BackupMessage {
  id: string
  created_at: Date | null
  conversation_id: string
  sender_type: string
  content_type: string
  content_text: string | null
  transcript: string | null
  media_url: string | null
  template_name: string | null
  status: string
  is_internal: boolean
  channel_type: string | null
  channel_name: string | null
  contact_name: string | null
  contact_phone: string | null
  contact_email: string | null
  agent_name: string | null
  ai_name: string | null
}

const TEXT = {
  es: {
    header: ['Fecha', 'Conversación', 'Canal', 'Cuenta', 'Contacto', 'Teléfono', 'Correo', 'Escribió', 'Nombre de quien escribió', 'Tipo', 'Mensaje', 'Archivo', 'Plantilla', 'Estado', 'Nota interna'],
    sender: { customer: 'Cliente', agent: 'Equipo', bot: 'IA / automatización', system: 'Sistema' } as Record<string, string>,
    yes: 'Sí',
    no: 'No',
  },
  en: {
    header: ['Date', 'Conversation', 'Channel', 'Account', 'Contact', 'Phone', 'Email', 'Written by', 'Name of who wrote it', 'Type', 'Message', 'File', 'Template', 'Status', 'Internal note'],
    sender: { customer: 'Customer', agent: 'Team', bot: 'AI / automation', system: 'System' } as Record<string, string>,
    yes: 'Yes',
    no: 'No',
  },
}

export function backupHeader(lang: BackupLang): string[] {
  return TEXT[lang].header
}

/** "2026-11-26 14:03:22" in the business's time zone (UTC if it isn't a valid one). */
export function localDate(d: Date | null, timeZone: string): string {
  if (!d) return ''
  const opts: Intl.DateTimeFormatOptions = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }
  try {
    return new Intl.DateTimeFormat('sv-SE', { ...opts, timeZone }).format(d)
  } catch {
    return new Intl.DateTimeFormat('sv-SE', { ...opts, timeZone: 'UTC' }).format(d)
  }
}

export function backupRow(m: BackupMessage, o: { lang: BackupLang; timeZone: string; origin: string }): (string | null)[] {
  const t = TEXT[o.lang]
  const who = m.sender_type === 'customer' ? m.contact_name : m.sender_type === 'agent' ? m.agent_name : m.ai_name
  // A voice note's text is its transcript.
  const text = m.content_text?.trim() ? m.content_text : m.transcript
  const media = m.media_url ? (m.media_url.startsWith('/') ? `${o.origin}${m.media_url}` : m.media_url) : null
  return [
    localDate(m.created_at, o.timeZone),
    m.conversation_id,
    m.channel_type,
    m.channel_name,
    m.contact_name,
    m.contact_phone,
    m.contact_email,
    t.sender[m.sender_type] ?? m.sender_type,
    who,
    m.content_type,
    text,
    media,
    m.template_name,
    m.status,
    m.is_internal ? t.yes : t.no,
  ]
}

/** backup-conversaciones-2026-11-01_2026-11-26.csv */
export function backupFileName(lang: BackupLang, from: string | null, to: string | null): string {
  const base = lang === 'en' ? 'conversations-backup' : 'respaldo-conversaciones'
  return `${base}${from || to ? `-${from ?? (lang === 'en' ? 'start' : 'inicio')}_${to ?? (lang === 'en' ? 'today' : 'hoy')}` : ''}.csv`
}
