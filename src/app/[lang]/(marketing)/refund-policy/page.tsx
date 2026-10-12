"use client";

import React from "react";
import { Landmark } from "lucide-react";
import { useI18n } from "@/i18n/client";
import { CompanyDetails } from "@/components/marketing/company-details";

export default function RefundPolicyPage() {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-20 space-y-10">
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
          <Landmark className="size-3" /> {t("mktRefund.badge")}
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">
          {t("mktRefund.title")}
        </h1>
        <p className="text-xs text-[var(--m-text-muted)]">{t("mktRefund.updated")}</p>
      </div>

      <div className="space-y-8 text-xs sm:text-sm text-[var(--m-text-secondary)] leading-relaxed">
        <p>
          {t("mktRefund.intro")}
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktRefund.s1.title")}</h3>
          <p>
            {t("mktRefund.s1.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktRefund.s1.i1")}</li>
            <li>{t("mktRefund.s1.i2")}</li>
            <li>{t("mktRefund.s1.i3")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktRefund.s2.title")}</h3>
          <p>
            {t("mktRefund.s2.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktRefund.s2.i1")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktRefund.s3.title")}</h3>
          <p>
            {t("mktRefund.s3.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktRefund.s3.i1")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktRefund.s4.title")}</h3>
          <p>
            {t("mktRefund.s4.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktRefund.s5.title")}</h3>
          <p>
            {t("mktRefund.s5.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktRefund.s5.i1")}</li>
            <li>{t("mktRefund.s5.i2")}</li>
          </ul>
        </section>

        <section className="space-y-3 text-center pt-8 border-t border-[var(--m-border-primary)]/50">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktRefund.s6.title")}</h3>
          <p>
            {t("mktRefund.s6.body")}
          </p>
          <CompanyDetails emailLabel={t("mktRefund.s6.emailLabel")} />
        </section>
      </div>
    </div>
  );
}
