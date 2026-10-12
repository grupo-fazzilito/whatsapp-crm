"use client";

import { useI18n } from "@/i18n/client";
import { COMPANY, companyAddress } from "@/lib/company";

/** Legal entity block used at the end of the legal pages. */
export function CompanyDetails({ emailLabel }: { emailLabel?: string }) {
  const { locale } = useI18n();
  return (
    <div className="text-xs text-[var(--m-text-tertiary)] mt-3 space-y-1">
      <p className="font-bold text-[var(--m-text-primary)]">{COMPANY.legalName}</p>
      <p>{COMPANY.taxIdLabel} {COMPANY.taxId}</p>
      <p>{companyAddress(locale)}</p>
      <p>
        {emailLabel ? `${emailLabel} ` : null}
        <a href={`mailto:${COMPANY.email}`} className="text-emerald-400 hover:underline">{COMPANY.email}</a>
      </p>
    </div>
  );
}
