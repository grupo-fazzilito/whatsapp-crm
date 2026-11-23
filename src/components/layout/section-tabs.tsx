"use client";

import { Suspense } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useT } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import { activeSubTab, groupForPath, sectionGroups } from "./nav-groups";
import { SideMenu, SideMenuLayout, type SideMenuItem } from "./side-menu";

/**
 * Pages that share one sidebar entry (Settings: General / Business setup;
 * Automations / Flows / …) get an inner menu on the left listing them, with
 * each page's own options (?tab=) as sub-options. Other pages render as is.
 */
function SectionNavInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useT();
  const { modules, label, can, workspace } = useWorkspace();
  const group = groupForPath(
    sectionGroups({ t, label, modules, isAdmin: can("admin"), industry: workspace?.industry }),
    pathname,
  );
  if (!group) return <>{children}</>;

  const items: SideMenuItem[] = group.map((page) => {
    const here = page.href === pathname;
    const open = here && page.tabs ? activeSubTab(page.tabs, searchParams.get("tab")) : null;
    return {
      key: page.href,
      label: page.label,
      href: page.href,
      active: here,
      children: page.tabs?.map((sub) => ({
        key: sub.key,
        label: sub.label,
        icon: sub.icon,
        href: `${page.href}?tab=${sub.key}`,
        active: open === sub.key,
      })),
    };
  });

  return <SideMenuLayout menu={<SideMenu items={items} label={t("nav.sectionMenu")} />}>{children}</SideMenuLayout>;
}

export function SectionNav({ children }: { children: React.ReactNode }) {
  // useSearchParams needs a Suspense boundary; meanwhile the page shows without the menu.
  return (
    <Suspense fallback={children}>
      <SectionNavInner>{children}</SectionNavInner>
    </Suspense>
  );
}
