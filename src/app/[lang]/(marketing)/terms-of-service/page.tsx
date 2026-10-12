"use client";

import React from "react";
import { Scale } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { CompanyDetails } from "@/components/marketing/company-details";
import { COMPANY } from "@/lib/company";

export default function TermsOfServicePage() {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-20 space-y-10">
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
          <Scale className="size-3" /> {t("mktTermsService.badge")}
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">
          {t("mktTermsService.title")}
        </h1>
        <p className="text-xs text-[var(--m-text-muted)]">{t("mktTermsService.updated")}</p>
      </div>

      <div className="space-y-8 text-xs sm:text-sm text-[var(--m-text-secondary)] leading-relaxed">
        <p>
          {t("mktTermsService.intro")}
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s1.title")}</h3>
          <p>
            {t("mktTermsService.s1.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s2.title")}</h3>
          <p>
            {t("mktTermsService.s2.body")}
          </p>
          <ul className="list-disc pl-5 space-y-2 text-[var(--m-text-tertiary)]">
            <li>{t("mktTermsService.s2.i1")}</li>
            <li>{t("mktTermsService.s2.i2")}</li>
            <li>{t("mktTermsService.s2.i3")}</li>
            <li>{t("mktTermsService.s2.i4")}</li>
            <li>{t("mktTermsService.s2.i5")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s3.title")}</h3>
          <p>
            {t("mktTermsService.s3.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s4.title")}</h3>
          <p>
            {t("mktTermsService.s4.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s5.title")}</h3>
          <p>
            {t("mktTermsService.s5.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s6.title")}</h3>
          <p>
            {t("mktTermsService.s6.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s7.title")}</h3>
          <p>
            {t("mktTermsService.s7.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s8.title")}</h3>
          <p>
            {t("mktTermsService.s8.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s9.title")}</h3>
          <p>
            {t("mktTermsService.s9.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s10.title")}</h3>
          <p>
            {t("mktTermsService.s10.body")}
          </p>
        </section>

        <section className="space-y-3 text-center pt-8 border-t border-[var(--m-border-primary)]/50">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsService.s11.title")}</h3>
          <p>
            {t("mktTermsService.s11.before")}<a href={`mailto:${COMPANY.email}`} className="text-emerald-400 hover:underline">{COMPANY.email}</a>{t("mktTermsService.s11.after")}
          </p>
          <CompanyDetails />
        </section>
      </div>
    </div>
  );
}
