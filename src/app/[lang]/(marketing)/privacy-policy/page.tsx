"use client";

import React from "react";
import { Shield } from "lucide-react";
import { useI18n, useLocalePath } from "@/i18n/client";
import { CompanyDetails } from "@/components/marketing/company-details";

export default function PrivacyPolicyPage() {
  const { t } = useI18n();
  const lp = useLocalePath();
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-20 space-y-10">
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
          <Shield className="size-3" /> {t("mktPrivacy.badge")}
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">
          {t("mktPrivacy.title")}
        </h1>
        <p className="text-xs text-[var(--m-text-muted)]">{t("mktPrivacy.updated")}</p>
      </div>

      <div className="space-y-8 text-xs sm:text-sm text-[var(--m-text-secondary)] leading-relaxed">
        <p>
          {t("mktPrivacy.intro")}
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s1.title")}</h3>
          <p>
            {t("mktPrivacy.s1.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktPrivacy.s1.i1")}</li>
            <li>{t("mktPrivacy.s1.i2")}</li>
            <li>{t("mktPrivacy.s1.i3")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s2.title")}</h3>
          <p>
            {t("mktPrivacy.s2.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s3.title")}</h3>
          <p>
            {t("mktPrivacy.s3.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s4.title")}</h3>
          <p>
            {t("mktPrivacy.s4.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s5.title")}</h3>
          <p>
            {t("mktPrivacy.s5.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s6.title")}</h3>
          <p>
            {t("mktPrivacy.s6.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s7.title")}</h3>
          <p>
            {t("mktPrivacy.s7.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s8.title")}</h3>
          <p>
            {t("mktPrivacy.s8.before")}<a href={lp("/data-deletion")} className="text-emerald-400 hover:underline">{t("mktPrivacy.s8.link")}</a>{t("mktPrivacy.s8.after")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s9.title")}</h3>
          <p>
            {t("mktPrivacy.s9.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.authorities.title")}</h3>
          <p>
            {t("mktPrivacy.authorities.body")}
          </p>
        </section>

        <section className="space-y-3 text-center pt-8 border-t border-[var(--m-border-primary)]/50">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktPrivacy.s10.title")}</h3>
          <p>
            {t("mktPrivacy.s10.body")}
          </p>
          <CompanyDetails emailLabel={t("mktPrivacy.s10.emailLabel")} />
        </section>
      </div>
    </div>
  );
}
