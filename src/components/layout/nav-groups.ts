// Pages that share one menu entry and are switched with tabs at the top of
// the page (SectionTabs). The sidebar marks the entry active on any of them.

export interface SectionTab {
  href: string
  /** i18n key, or a ready label (industry nouns). */
  label: string
}

export interface NavContext {
  t: (key: string) => string
  label: (noun: 'productPlural' | 'servicePlural') => string
  modules: { products?: boolean; services?: boolean }
  isAdmin: boolean
  industry: string | null | undefined
}

/** Tab groups; each list page shows its group's tabs. */
export function sectionGroups(ctx: NavContext): SectionTab[][] {
  const groups: SectionTab[][] = [
    [
      { href: '/automations', label: ctx.t('nav.automations') },
      { href: '/flows', label: ctx.t('nav.flows') },
      { href: '/automations/comments', label: ctx.t('comments.tab') },
    ],
    [
      { href: '/agents', label: ctx.t('nav.agentsList') },
      { href: '/business/faqs', label: ctx.t('nav.faqs') },
      { href: '/business/logs', label: ctx.t('nav.aiLogs') },
    ],
    [
      { href: '/settings', label: ctx.t('nav.general') },
      ...(ctx.isAdmin ? [{ href: '/business/setup', label: ctx.t('nav.setup') }] : []),
    ],
  ]
  // Catalog: products, plus services (when the industry has both) and portal imports (real estate).
  const catalog: SectionTab[] = []
  if (ctx.modules.products) catalog.push({ href: '/catalog', label: ctx.label('productPlural') })
  if (ctx.modules.products && ctx.modules.services) catalog.push({ href: '/business/services', label: ctx.label('servicePlural') })
  if (ctx.modules.products && ctx.industry === 'real_estate' && ctx.isAdmin) catalog.push({ href: '/real-estate/portals', label: ctx.t('portals.navTitle') })
  groups.push(catalog)
  return groups.filter((g) => g.length > 1)
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
