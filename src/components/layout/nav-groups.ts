// Pages that share one menu entry, listed in the page's inner menu on the
// left (SectionNav), each with its own options as sub-options. The sidebar
// marks the entry active on any of them.
import { Coins, Factory, Clock, ListPlus, MessageSquare, Palette, Plug, Radio, Route, ShoppingBag, Store, Tag, User, Users, UsersRound, Zap, type LucideIcon } from 'lucide-react'

/** One option inside a page, opened with ?tab=<key> (the first one is the default). */
export interface SubTab {
  key: string
  label: string
  icon?: LucideIcon
}

export interface SectionTab {
  href: string
  /** i18n key, or a ready label (industry nouns). */
  label: string
  tabs?: SubTab[]
}

export interface NavContext {
  t: (key: string) => string
  label: (noun: 'productPlural' | 'servicePlural') => string
  modules: { products?: boolean; services?: boolean; bookings?: boolean; orders?: boolean }
  isAdmin: boolean
  industry: string | null | undefined
}

/** Settings › General: everyone's tabs, plus billing and integrations for admins. */
export function settingsTabs(ctx: Pick<NavContext, 't' | 'isAdmin'>): SubTab[] {
  return [
    { key: 'profile', label: ctx.t('settingsPage.tabs.profile'), icon: User },
    { key: 'team', label: ctx.t('team.tab'), icon: Users },
    // Kept as 'whatsapp' so old /settings?tab=whatsapp links still land there.
    { key: 'whatsapp', label: ctx.t('channels.navTitle'), icon: Radio },
    { key: 'templates', label: ctx.t('settingsPage.tabs.templates'), icon: MessageSquare },
    { key: 'tags', label: ctx.t('settingsPage.tabs.tags'), icon: Tag },
    { key: 'custom-fields', label: ctx.t('crm.customFields.tab'), icon: ListPlus },
    { key: 'quick-replies', label: ctx.t('inboxpro.quickReplies.tab'), icon: Zap },
    { key: 'teams', label: ctx.t('inboxpro.teams.tab'), icon: UsersRound },
    { key: 'appearance', label: ctx.t('settingsPage.tabs.appearance'), icon: Palette },
    ...(ctx.isAdmin
      ? [
          { key: 'billing', label: ctx.t('billing.tab'), icon: Coins },
          { key: 'integrations', label: ctx.t('calendly.tab'), icon: Plug },
        ]
      : []),
  ]
}

/** Settings › Business setup. */
export function setupTabs(ctx: Pick<NavContext, 't' | 'modules' | 'industry'>): SubTab[] {
  return [
    { key: 'profile', label: ctx.t('business.setup.tab.profile'), icon: Store },
    { key: 'industry', label: ctx.t('business.setup.tab.industry'), icon: Factory },
    { key: 'hours', label: ctx.t('business.setup.tab.hours'), icon: Clock },
    ...(ctx.modules.orders ? [{ key: 'orders', label: ctx.t('orders.settings.tab'), icon: ShoppingBag }] : []),
    ...(ctx.industry === 'real_estate' ? [{ key: 'leadRouting', label: ctx.t('leads.routing.tab'), icon: Route }] : []),
  ]
}

/** The open sub-option: ?tab when it's one of them, else the first. */
export function activeSubTab(tabs: SubTab[], query: string | null): string {
  return tabs.find((s) => s.key === query)?.key ?? tabs[0]?.key ?? ''
}

/** Groups of pages; each list page shows its group in the inner menu. */
export function sectionGroups(ctx: NavContext): SectionTab[][] {
  const groups: SectionTab[][] = [
    [
      { href: '/automations', label: ctx.t('nav.automations') },
      { href: '/flows', label: ctx.t('nav.flows') },
      { href: '/automations/comments', label: ctx.t('comments.tab') },
      ...(ctx.modules.bookings ? [{ href: '/automations/reminders', label: ctx.t('bookings.reminders.page.tab') }] : []),
    ],
    [
      { href: '/agents', label: ctx.t('nav.agentsList') },
      { href: '/business/faqs', label: ctx.t('nav.faqs') },
      { href: '/business/logs', label: ctx.t('nav.aiLogs') },
    ],
    [
      { href: '/settings', label: ctx.t('nav.general'), tabs: settingsTabs(ctx) },
      ...(ctx.isAdmin ? [{ href: '/business/setup', label: ctx.t('nav.setup'), tabs: setupTabs(ctx) }] : []),
    ],
  ]
  // Catalog: products, plus services (when the industry has both).
  const catalog: SectionTab[] = []
  if (ctx.modules.products) catalog.push({ href: '/catalog', label: ctx.label('productPlural') })
  if (ctx.modules.products && ctx.modules.services) catalog.push({ href: '/business/services', label: ctx.label('servicePlural') })
  groups.push(catalog)
  // A lone page still gets the menu when it has options of its own (Settings for non-admins).
  return groups.filter((g) => g.length > 1 || !!g[0]?.tabs?.length)
}

/** The group whose tab is exactly this page (list pages only, not editors). */
export function groupForPath(groups: SectionTab[][], pathname: string): SectionTab[] | null {
  return groups.find((g) => g.some((tab) => tab.href === pathname)) ?? null
}

/** Every page that lights up a sidebar entry (its own route + its group's tabs). */
export function isActiveEntry(groups: SectionTab[][], href: string, pathname: string): boolean {
  const matches = (h: string) => pathname === h || (h !== '/dashboard' && pathname.startsWith(h + '/'))
  if (matches(href)) return true
  const group = groups.find((g) => g[0].href === href)
  return !!group?.some((tab) => matches(tab.href))
}
