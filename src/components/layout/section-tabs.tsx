"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/i18n/client";
import { useWorkspace } from "@/hooks/use-workspace";
import { cn } from "@/lib/utils";
import { groupForPath, sectionGroups } from "./nav-groups";

/** Tabs linking the pages that share one menu entry (e.g. Automations / Flows). */
export function SectionTabs() {
  const pathname = usePathname();
  const t = useT();
  const { modules, label, can, workspace } = useWorkspace();
  const group = groupForPath(
    sectionGroups({ t, label, modules, isAdmin: can("admin"), industry: workspace?.industry }),
    pathname,
  );
  if (!group) return null;
  return (
    <nav aria-label={t("nav.sections")} className="mb-5 max-w-full overflow-x-auto [scrollbar-width:thin]">
      <ul className="inline-flex min-w-max items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
        {group.map((tab) => {
          const active = tab.href === pathname;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active ? "bg-background text-primary shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
