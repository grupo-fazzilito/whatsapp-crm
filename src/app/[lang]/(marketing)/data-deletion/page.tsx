"use client";

import React from "react";
import { Trash2 } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { CompanyDetails } from "@/components/marketing/company-details";
import { COMPANY } from "@/lib/company";

export default function DataDeletionPage() {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-20 space-y-10">
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-red-500/25 bg-red-950/20 text-red-400 text-[10px] font-bold uppercase tracking-wider">
          <Trash2 className="size-3" /> {t("mktDataDeletion.badge")}
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">
          {t("mktDataDeletion.title")}
        </h1>
        <p className="text-xs text-[var(--m-text-muted)]">{t("mktDataDeletion.subtitle")}</p>
      </div>

      <div className="space-y-8 text-xs sm:text-sm text-[var(--m-text-secondary)] leading-relaxed">
        <p>
          {t("mktDataDeletion.intro")}
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktDataDeletion.howTitle")}</h3>
          <ol className="list-decimal pl-5 space-y-2 text-[var(--m-text-tertiary)]">
            <li>{t("mktDataDeletion.step1")}</li>
            <li>{t("mktDataDeletion.step2")}</li>
            <li>{t("mktDataDeletion.step3")}</li>
            <li>{t("mktDataDeletion.step4")}</li>
          </ol>
        </section>

        <section className="space-y-4 pt-8 border-t border-[var(--m-border-primary)]/50">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)] text-center">{t("mktDataDeletion.contactTitle")}</h3>
          <div className="grid grid-cols-1 gap-6 max-w-sm mx-auto pt-2">
            <div className="bg-[var(--m-bg-secondary)] border border-[var(--m-border-primary)] rounded-xl p-4 text-center space-y-2">
              <span className="text-[10px] uppercase font-bold text-[var(--m-text-muted)]">{t("mktDataDeletion.emailLabel")}</span>
              <p className="font-semibold text-[var(--m-text-primary)]">
                <a href={`mailto:${COMPANY.email}`} className="text-emerald-400 hover:underline">
                  {COMPANY.email}
                </a>
              </p>
            </div>
          </div>
          <div className="text-center [&>div]:mx-auto"><CompanyDetails /></div>
          <p className="text-xs text-[var(--m-text-muted)] text-center pt-4">
            {t("mktDataDeletion.footer")}
          </p>
        </section>
      </div>
    </div>
  );
}
