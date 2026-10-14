"use client";

import React from "react";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { useMarketingTheme } from "@/components/marketing/marketing-theme-provider";
import { useI18n, useLocalePath } from "@/i18n/client";
import { COMPANY, companyAddress } from "@/lib/company";

export function Footer() {
  const { resolvedTheme } = useMarketingTheme();
  const { t, locale } = useI18n();
  const lp = useLocalePath();
  const isLight = resolvedTheme === "light";

  const productLinks = [
    { name: t("mktShell.nav.features"), href: lp("/features") },
    { name: t("mktShell.nav.pricing"), href: lp("/pricing") },
    { name: t("mktShell.nav.aiAutomation"), href: lp("/ai-automation") },
    { name: t("mktShell.footer.useCases"), href: lp("/") },
    { name: t("mktShell.footer.changelog"), href: lp("/changelog") },
  ];

  const quickLinks = [
    { name: t("mktShell.nav.about"), href: lp("/about-us") },
    { name: t("mktShell.footer.contact"), href: lp("/contact-us") },
    { name: t("mktShell.footer.privacy"), href: lp("/privacy-policy") },
    { name: t("mktShell.footer.terms"), href: lp("/terms-and-conditions") },
    { name: t("mktShell.footer.refund"), href: lp("/refund-policy") },
    { name: t("mktShell.footer.complaints"), href: lp("/libro-de-reclamaciones") },
  ];

  return (
    <footer className="relative w-full border-t border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] py-16 px-4 md:px-6 overflow-hidden">
      {/* Background radial highlight */}
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[150px] rounded-full bg-emerald-500/5 blur-3xl pointer-events-none" />

      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-6 gap-10 md:gap-8 relative z-10">
        {/* Brand Column */}
        <div className="col-span-1 md:col-span-2 space-y-4">
          <Link href={lp("/")} className="inline-block">
            <img
              src={isLight ? "/images/logo/whasalia-logo-light.png" : "/images/logo/whasalia-logo.png"}
              alt="Whasalia"
              className="h-8 w-auto object-contain"
            />
          </Link>
          <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed max-w-sm">
            {t("mktShell.footer.about")}
          </p>
          <div className="pt-2">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-extrabold uppercase tracking-wider">
              {t("mktShell.footer.partner")}
            </span>
          </div>
        </div>

        {/* Product Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">{t("mktShell.solutions")}</h6>
          <ul className="space-y-2.5">
            {productLinks.map((link) => (
              <li key={link.name}>
                <Link href={link.href} className="text-xs text-[var(--m-text-muted)] hover:text-[var(--m-text-heading)] transition-colors">
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Legal & Quick Links Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">{t("mktShell.footer.quickLinks")}</h6>
          <ul className="space-y-2.5">
            {quickLinks.map((link) => (
              <li key={link.name}>
                <Link href={link.href} className="text-xs text-[var(--m-text-muted)] hover:text-[var(--m-text-heading)] transition-colors">
                  {link.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {/* Contact Us Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">{t("mktShell.footer.contact")}</h6>
          <ul className="space-y-2.5 text-xs text-[var(--m-text-muted)]">
            <li>{COMPANY.legalName}</li>
            <li>{COMPANY.taxIdLabel} {COMPANY.taxId}</li>
            <li>{companyAddress(locale)}</li>
            <li className="pt-1">
              <a href={`mailto:${COMPANY.email}`} className="text-emerald-400 hover:underline">
                {COMPANY.email}
              </a>
            </li>
          </ul>
        </div>

        {/* Trust signals Column */}
        <div className="col-span-1 space-y-4">
          <h6 className="text-[10px] uppercase font-bold tracking-wider text-[var(--m-text-tertiary)]">{t("mktShell.footer.trust")}</h6>
          <ul className="space-y-2 text-[10px] text-[var(--m-text-muted)] font-semibold">
            <li className="text-emerald-400">✓ {t("mktShell.footer.t1")}</li>
            <li className="text-emerald-400">✓ {t("mktShell.footer.t2")}</li>
            <li className="text-emerald-400">✓ {t("mktShell.footer.t3")}</li>
            <li className="text-emerald-400">✓ {t("mktShell.footer.t4")}</li>
            <li className="text-emerald-400">✓ {t("mktShell.footer.t5")}</li>
          </ul>
        </div>
      </div>

      {/* Meta API disclaimer & Copyright footer */}
      <div className="max-w-6xl mx-auto mt-12 pt-8 border-t border-[var(--m-border-primary)]/50 space-y-4 relative z-10 text-center">
        <p className="text-[10px] leading-relaxed text-[var(--m-text-muted)] max-w-3xl mx-auto">
          {t("mktShell.footer.disclaimer")}
        </p>
        <Link
          href={lp("/libro-de-reclamaciones")}
          className="inline-flex items-center gap-2 rounded-lg border border-[var(--m-border-primary)] px-3 py-2 text-xs font-semibold text-[var(--m-text-secondary)] hover:border-emerald-500/50 hover:text-[var(--m-text-heading)] transition-colors"
        >
          <BookOpen className="size-4 text-emerald-400" aria-hidden /> {t("mktShell.footer.complaints")}
        </Link>
        <div className="text-[10px] text-[var(--m-text-muted)] pt-2">
          {t("mktShell.footer.rights", { company: COMPANY.legalName, taxId: `${COMPANY.taxIdLabel} ${COMPANY.taxId}` })}
        </div>
      </div>
    </footer>
  );
}
