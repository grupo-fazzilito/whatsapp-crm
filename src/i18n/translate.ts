import esCore from './messages/es/core.json'
import esChannels from './messages/es/channels.json'
import esAgents from './messages/es/agents.json'
import esWebchat from './messages/es/webchat.json'
import esInbox from './messages/es/inbox.json'
import esBusiness from './messages/es/business.json'
import esRouting from './messages/es/routing.json'
import esAdmin from './messages/es/admin.json'
import esBookings from './messages/es/bookings.json'
import esCatalogImport from './messages/es/catalog-import.json'
import esCatalog from './messages/es/catalog.json'
import esFollowups from './messages/es/followups.json'
import enCore from './messages/en/core.json'
import enChannels from './messages/en/channels.json'
import enAgents from './messages/en/agents.json'
import enWebchat from './messages/en/webchat.json'
import enInbox from './messages/en/inbox.json'
import enBusiness from './messages/en/business.json'
import enRouting from './messages/en/routing.json'
import enAdmin from './messages/en/admin.json'
import enBookings from './messages/en/bookings.json'
import enCatalogImport from './messages/en/catalog-import.json'
import enCatalog from './messages/en/catalog.json'
import enFollowups from './messages/en/followups.json'
import type { AppLocale } from './config'

// One file per area (core, channels, agents, webchat, inbox, business, routing) so features
// can add strings without touching each other's files. Each file's
// top-level keys become namespaces: t('channels.title').
type Tree = { [key: string]: string | Tree }

const DICTS: Record<AppLocale, Tree> = {
  es: { ...esCore, ...esChannels, ...esAgents, ...esWebchat, ...esInbox, ...esBusiness, ...esRouting, ...esAdmin, ...esBookings, ...esCatalogImport, ...esCatalog, ...esFollowups },
  en: { ...enCore, ...enChannels, ...enAgents, ...enWebchat, ...enInbox, ...enBusiness, ...enRouting, ...enAdmin, ...enBookings, ...enCatalogImport, ...enCatalog, ...enFollowups },
}

/** Dotted-path key into the message tree, e.g. "nav.inbox". */
export type TranslationKey = string

function lookup(dict: Tree, key: string): string | undefined {
  let cur: string | Tree | undefined = dict
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && part in cur) cur = cur[part]
    else return undefined
  }
  return typeof cur === 'string' ? cur : undefined
}

/**
 * Translator for `locale`. Missing keys fall back to Spanish, then to the
 * key itself. `{name}` placeholders are filled from `vars`.
 */
export function createTranslator(locale: AppLocale) {
  return (key: TranslationKey, vars?: Record<string, string | number>): string => {
    const raw = lookup(DICTS[locale], key) ?? lookup(DICTS.es, key) ?? key
    if (!vars) return raw
    return raw.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`))
  }
}

export type Translator = ReturnType<typeof createTranslator>
