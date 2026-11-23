"use client";

import { useRouter } from "next/navigation";
import { useI18n } from "@/i18n/client";
import { REGIONS, REGION_COOKIE, REGION_INFO, type Region } from "@/lib/regions";

/** Which country's prices to show. The visitor's country picks it first; this lets them change it. */
export function RegionPicker({ region }: { region: Region }) {
  const { t } = useI18n();
  const router = useRouter();
  const change = (next: Region) => {
    document.cookie = `${REGION_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  };
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-[var(--m-text-tertiary)]">
      <label htmlFor="mkt-region">{t("mktPlans.region.label")}</label>
      <select
        id="mkt-region"
        value={region}
        onChange={(e) => change(e.target.value as Region)}
        className="rounded-md border border-[var(--m-border,rgba(148,163,184,0.3))] bg-transparent px-2 py-1 text-[var(--m-text-heading)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
      >
        {REGIONS.map((r) => (
          <option key={r} value={r} className="text-slate-900">
            {REGION_INFO[r].flag} {REGION_INFO[r].country}
          </option>
        ))}
      </select>
      <span>· {t(`mktPlans.region.currency${REGION_INFO[region].currency}`)}</span>
    </div>
  );
}
