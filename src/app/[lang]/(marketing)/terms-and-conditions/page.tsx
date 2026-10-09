"use client";

import React from "react";
import { Scale } from "lucide-react";
import { useI18n } from "@/i18n/client";

export default function TermsAndConditionsPage() {
  const { t } = useI18n();
  return (
    <div className="w-full max-w-4xl mx-auto px-4 md:px-6 py-20 space-y-10">
      <div className="space-y-4 border-b border-[var(--m-border-primary)] pb-8">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-emerald-950/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
          <Scale className="size-3" /> {t("mktTermsConditions.badge")}
        </div>
        <h1 className="text-3xl sm:text-5xl font-extrabold text-[var(--m-text-heading)] tracking-tight">
          {t("mktTermsConditions.title")}
        </h1>
        <p className="text-xs text-[var(--m-text-muted)]">{t("mktTermsConditions.updated")}</p>
      </div>

      <div className="space-y-8 text-xs sm:text-sm text-[var(--m-text-secondary)] leading-relaxed">
        <p>
          {t("mktTermsConditions.intro")}
        </p>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsConditions.s1.title")}</h3>
          <p>
            {t("mktTermsConditions.s1.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktTermsConditions.s1.i1")}</li>
            <li>{t("mktTermsConditions.s1.i2")}</li>
            <li>{t("mktTermsConditions.s1.i3")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsConditions.s2.title")}</h3>
          <p>
            {t("mktTermsConditions.s2.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktTermsConditions.s2.i1")}</li>
            <li>{t("mktTermsConditions.s2.i2")}</li>
            <li>{t("mktTermsConditions.s2.i3")}</li>
            <li>{t("mktTermsConditions.s2.i4")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsConditions.s3.title")}</h3>
          <p>
            {t("mktTermsConditions.s3.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktTermsConditions.s3.i1")}</li>
            <li>{t("mktTermsConditions.s3.i2")}</li>
            <li>{t("mktTermsConditions.s3.i3")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsConditions.s4.title")}</h3>
          <p>
            {t("mktTermsConditions.s4.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktTermsConditions.s4.i1")}</li>
            <li>{t("mktTermsConditions.s4.i2")}</li>
            <li>{t("mktTermsConditions.s4.i3")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsConditions.s5.title")}</h3>
          <p>
            {t("mktTermsConditions.s5.body")}
          </p>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsConditions.s6.title")}</h3>
          <p>
            {t("mktTermsConditions.s6.body")}
          </p>
          <ul className="list-disc pl-5 space-y-1 text-[var(--m-text-tertiary)]">
            <li>{t("mktTermsConditions.s6.i1")}</li>
            <li>{t("mktTermsConditions.s6.i2")}</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsConditions.s7.title")}</h3>
          <p>
            {t("mktTermsConditions.s7.body")}
          </p>
        </section>

        <section className="space-y-3 text-center pt-8 border-t border-[var(--m-border-primary)]/50">
          <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktTermsConditions.s8.title")}</h3>
          <p>
            {t("mktTermsConditions.s8.body")}
          </p>
          <div className="text-xs text-[var(--m-text-tertiary)] mt-3 space-y-1">
            <p className="font-bold text-[var(--m-text-primary)]">Whasalia</p>
            <p>{t("mktTermsConditions.s8.location")}</p>
            <p>
              {t("mktTermsConditions.s8.emailLabel")} <a href="mailto:chatnexgen@gmail.com" className="text-emerald-400 hover:underline">chatnexgen@gmail.com</a>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
