"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, type LucideIcon } from "lucide-react";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

/** One entry of a page's inner menu: a link (href) or a local switch (onSelect), with optional sub-options. */
export interface SideMenuItem {
  key: string;
  label: string;
  href?: string;
  onSelect?: () => void;
  icon?: LucideIcon;
  active?: boolean;
  /** Small count next to the label (e.g. posts waiting for approval). */
  badge?: number;
  children?: SideMenuItem[];
}

const isActive = (item: SideMenuItem): boolean => !!item.active || !!item.children?.some(isActive);

/** "General › Channels": where the user is, for the mobile button. */
function trail(items: SideMenuItem[]): string[] {
  for (const item of items) {
    if (!isActive(item)) continue;
    const sub = item.children?.find(isActive);
    return sub ? [item.label, sub.label] : [item.label];
  }
  return [items[0]?.label ?? ""];
}

function Entry({ item, depth, onPick }: { item: SideMenuItem; depth: number; onPick?: () => void }) {
  const Icon = item.icon;
  // A parent whose sub-option is the one open is "on the way", not the current page.
  const current = !!item.active && !item.children?.some(isActive);
  const className = cn(
    "flex w-full items-center gap-2 rounded-md text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    depth === 0 ? "px-3 py-2 font-medium" : "py-1.5 pl-3 pr-3",
    current
      ? "bg-primary/10 text-primary"
      : isActive(item)
        ? "text-foreground"
        : "text-muted-foreground hover:bg-muted hover:text-foreground",
  );
  const body = (
    <>
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {!!item.badge && (
        <span className="rounded-full bg-amber-500 px-1.5 text-[11px] font-semibold text-white">{item.badge}</span>
      )}
    </>
  );
  const pick = () => {
    item.onSelect?.();
    onPick?.();
  };
  return (
    <li>
      {item.href ? (
        <Link href={item.href} scroll={false} aria-current={current ? "page" : undefined} className={className} onClick={pick}>
          {body}
        </Link>
      ) : (
        <button type="button" aria-current={current ? "page" : undefined} className={className} onClick={pick}>
          {body}
        </button>
      )}
      {item.children && item.children.length > 0 && (
        <ul className="mb-1 ml-4 mt-0.5 space-y-0.5 border-l border-border pl-2">
          {item.children.map((c) => (
            <Entry key={c.key} item={c} depth={depth + 1} onPick={onPick} />
          ))}
        </ul>
      )}
    </li>
  );
}

function Tree({ items, onPick }: { items: SideMenuItem[]; onPick?: () => void }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <Entry key={item.key} item={item} depth={0} onPick={onPick} />
      ))}
    </ul>
  );
}

/**
 * A page's inner menu: a vertical list on the left on wide screens; on phones
 * a full-width button that says where you are and opens the same list.
 */
export function SideMenu({ items, label }: { items: SideMenuItem[]; label: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const where = trail(items);

  return (
    <>
      <nav aria-label={label} className="hidden lg:block">
        <Tree items={items} />
      </nav>

      <div className="lg:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="flex w-full items-center gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-left text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="min-w-0 flex-1 truncate">
            {where.length > 1 && <span className="text-muted-foreground">{where[0]} › </span>}
            <span className="font-medium text-foreground">{where[where.length - 1]}</span>
          </span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className="sr-only">{t("nav.openSectionMenu")}</span>
        </button>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] gap-2 rounded-t-2xl pb-[max(1rem,env(safe-area-inset-bottom))]">
            <SheetHeader className="pb-0">
              <SheetTitle>{label}</SheetTitle>
            </SheetHeader>
            <nav aria-label={label} className="overflow-y-auto px-3 pb-2">
              <Tree items={items} onPick={() => setOpen(false)} />
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </>
  );
}

/** Menu on the left, page on the right (stacked on phones). */
export function SideMenuLayout({ menu, children }: { menu: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start lg:gap-8">
      <aside className="lg:sticky lg:top-0 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">{menu}</aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
