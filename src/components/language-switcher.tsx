"use client";

import { usePathname, useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { LOCALES, type AppLocale } from "@/i18n/config";
import { isMarketingPath, localizedPath, splitLocale } from "@/i18n/marketing-routes";
import { cn } from "@/lib/utils";

// ES / EN pill. Spanish first (it is the default). On public pages it moves
// to the same page under the other language's URL (/es/... ↔ /en/...);
// elsewhere it saves the choice in the locale cookie and refreshes so
// server-rendered text switches too.

const LABELS: Record<AppLocale, { short: string; name: string }> = {
  es: { short: "ES", name: "Español" },
  en: { short: "EN", name: "English" },
};

export function LanguageSwitcher({ variant = "app", className }: { variant?: "app" | "marketing"; className?: string }) {
  const { locale, setLocale, t } = useI18n();
  const router = useRouter();
  const pathname = usePathname();

  const choose = (l: AppLocale) => {
    if (l === locale) return;
    setLocale(l);
    const page = splitLocale(pathname);
    if (page && isMarketingPath(page.path || "/")) {
      router.push(`${localizedPath(l, page.path)}${window.location.search}${window.location.hash}`);
    } else {
      router.refresh();
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("common.language")}
      className={cn(
        "flex items-center gap-0.5 rounded-full border p-0.5",
        variant === "marketing"
          ? "border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] backdrop-blur-md"
          : "border-border bg-card",
        className,
      )}
    >
      {LOCALES.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={LABELS[l].name}
            title={LABELS[l].name}
            onClick={() => choose(l)}
            className={cn(
              "h-7 min-w-9 rounded-full px-2 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
              active
                ? "bg-emerald-700 text-white shadow-sm"
                : variant === "marketing"
                  ? "text-[var(--m-text-tertiary)] hover:text-[var(--m-text-primary)]"
                  : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LABELS[l].short}
          </button>
        );
      })}
    </div>
  );
}
