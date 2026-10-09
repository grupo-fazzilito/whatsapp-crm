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
import esOrders from './messages/es/orders.json'
import enOrders from './messages/en/orders.json'
import esCrm from './messages/es/crm.json'
import enCrm from './messages/en/crm.json'
import esReports from './messages/es/reports.json'
import enReports from './messages/en/reports.json'
import esInboxPro from './messages/es/inboxpro.json'
import enInboxPro from './messages/en/inboxpro.json'
import esLeads from './messages/es/leads.json'
import enLeads from './messages/en/leads.json'
import esRealEstate from './messages/es/realestate.json'
import enRealEstate from './messages/en/realestate.json'
import esGcal from './messages/es/gcal.json'
import enGcal from './messages/en/gcal.json'
import esPortals from './messages/es/portals.json'
import enPortals from './messages/en/portals.json'
import esAiAssist from './messages/es/aiassist.json'
import enAiAssist from './messages/en/aiassist.json'
import esIntegrations from './messages/es/integrations.json'
import enIntegrations from './messages/en/integrations.json'
import esMetaWa from './messages/es/metawa.json'
import enMetaWa from './messages/en/metawa.json'
import esBilling from './messages/es/billing.json'
import esSupport from './messages/es/support.json'
import esDash from './messages/es/dashboard.json'
import enDash from './messages/en/dashboard.json'
import enSupport from './messages/en/support.json'
import enBilling from './messages/en/billing.json'
import esAuth from './messages/es/auth.json'
import enAuth from './messages/en/auth.json'
import esMktHome from './messages/es/marketing-home.json'
import enMktHome from './messages/en/marketing-home.json'
import esMktShell from './messages/es/marketing-shell.json'
import enMktShell from './messages/en/marketing-shell.json'
import type { AppLocale } from './config'

// One file per area (core, channels, agents, webchat, inbox, business, routing) so features
// can add strings without touching each other's files. Each file's
// top-level keys become namespaces: t('channels.title').
type Tree = { [key: string]: string | Tree }

const DICTS: Record<AppLocale, Tree> = {
  es: { ...esCore, ...esChannels, ...esAgents, ...esWebchat, ...esInbox, ...esBusiness, ...esRouting, ...esAdmin, ...esBookings, ...esCatalogImport, ...esCatalog, ...esFollowups, ...esOrders, ...esCrm, ...esReports, ...esInboxPro, ...esLeads, ...esRealEstate, ...esGcal, ...esPortals, ...esAiAssist, ...esMetaWa, ...esIntegrations, ...esBilling, ...esSupport, ...esDash, ...esMktShell, ...esAuth, ...esMktHome },
  en: { ...enCore, ...enChannels, ...enAgents, ...enWebchat, ...enInbox, ...enBusiness, ...enRouting, ...enAdmin, ...enBookings, ...enCatalogImport, ...enCatalog, ...enFollowups, ...enOrders, ...enCrm, ...enReports, ...enInboxPro, ...enLeads, ...enRealEstate, ...enGcal, ...enPortals, ...enAiAssist, ...enMetaWa, ...enIntegrations, ...enBilling, ...enSupport, ...enDash, ...enMktShell, ...enAuth, ...enMktHome },
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
