"use client";

import React, { useState } from "react";
import { Sparkles, Mail, Building, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/client";
import { COMPANY, companyAddress } from "@/lib/company";

export default function ContactUsPage() {
  const { t, locale } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    setName("");
    setEmail("");
    setPhone("");
    setMsg("");
  };

  return (
    <div className="w-full max-w-6xl mx-auto px-4 md:px-6 py-20 grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
      {/* Contact Details Column */}
      <div className="space-y-6">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-emerald-500/25 bg-[var(--m-badge-bg)] text-emerald-500 text-[10px] font-bold uppercase tracking-wider">
          <Sparkles className="size-3.5" /> {t("mktContactUs.badge")}
        </div>
        <h1 className="text-4xl sm:text-6xl font-extrabold text-[var(--m-text-heading)] tracking-tight leading-[1.08]">
          {t("mktContactUs.titleLine1")} <br />
          <span className="bg-gradient-to-r from-emerald-400 to-teal-400 bg-clip-text text-transparent">
            {t("mktContactUs.titleHighlight")}
          </span>
        </h1>
        <p className="text-sm text-[var(--m-text-tertiary)] leading-relaxed">
          {t("mktContactUs.subtitle")}
        </p>

        {/* Corporate contact cards */}
        <div className="space-y-4 border-t border-[var(--m-border-primary)] pt-6 mt-6">
          <div className="flex items-center gap-3.5 text-xs text-[var(--m-text-tertiary)]">
            <Building className="size-4 text-emerald-400 shrink-0" />
            <div>
              <span className="block font-bold text-[var(--m-text-primary)]">{t("mktContactUs.companyLabel")}</span>
              <span className="block">{COMPANY.legalName}</span>
              <span>{COMPANY.taxIdLabel} {COMPANY.taxId}</span>
            </div>
          </div>
          <div className="flex items-center gap-3.5 text-xs text-[var(--m-text-tertiary)]">
            <Mail className="size-4 text-emerald-400 shrink-0" />
            <div>
              <span className="block font-bold text-[var(--m-text-primary)]">{t("mktContactUs.emailSupportLabel")}</span>
              <a href={`mailto:${COMPANY.email}`} className="hover:text-emerald-400 transition-colors">
                {COMPANY.email}
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3.5 text-xs text-[var(--m-text-tertiary)]">
            <Clock className="size-4 text-emerald-400 shrink-0" />
            <div>
              <span className="block font-bold text-[var(--m-text-primary)]">{t("mktContactUs.hoursLabel")}</span>
              <span>{t("mktContactUs.hoursValue")}</span>
            </div>
          </div>
          <div className="flex items-center gap-3.5 text-xs text-[var(--m-text-tertiary)]">
            <Building className="size-4 text-teal-400 shrink-0" />
            <div>
              <span className="block font-bold text-[var(--m-text-primary)]">{t("mktContactUs.addressLabel")}</span>
              <span>{companyAddress(locale)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Form column */}
      <div className="relative">
        <div className="absolute inset-0 bg-emerald-500/5 blur-[95px] pointer-events-none" />
        
        {submitted ? (
          <Card className="border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] p-6 backdrop-blur text-center relative z-10 shadow-2xl">
            <CardContent className="pt-6 space-y-4">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
                <Sparkles className="size-5" />
              </div>
              <h3 className="text-lg font-bold text-[var(--m-text-heading)]">{t("mktContactUs.successTitle")}</h3>
              <p className="text-xs text-[var(--m-text-tertiary)] leading-relaxed max-w-sm mx-auto">
                {t("mktContactUs.successDesc")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] p-2 backdrop-blur relative z-10 shadow-2xl">
            <CardContent className="pt-4">
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                  <Label htmlFor="name" className="text-xs font-bold text-[var(--m-text-tertiary)]">{t("mktContactUs.nameLabel")}</Label>
                  <Input
                    id="name"
                    type="text"
                    placeholder={t("mktContactUs.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    className="h-10 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="email" className="text-xs font-bold text-[var(--m-text-tertiary)]">{t("mktContactUs.emailLabel")}</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder={t("mktContactUs.emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="h-10 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="phone" className="text-xs font-bold text-[var(--m-text-tertiary)]">{t("mktContactUs.phoneFieldLabel")}</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+51 999 999 999"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    required
                    className="h-10 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20"
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label htmlFor="message" className="text-xs font-bold text-[var(--m-text-tertiary)]">{t("mktContactUs.messageLabel")}</Label>
                  <textarea
                    id="message"
                    rows={4}
                    placeholder={t("mktContactUs.messagePlaceholder")}
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    required
                    className="w-full bg-[var(--m-input-bg)] border border-[var(--m-input-border)] rounded-lg p-3 text-xs text-[var(--m-text-primary)] placeholder:text-slate-655 focus:outline-none focus:border-emerald-500/50 resize-none font-sans"
                  />
                </div>

                <Button
                  type="submit"
                  className="mt-2 h-10 w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-bold text-xs shadow-[0_0_12px_rgba(16,185,129,0.2)]"
                >
                  {t("mktContactUs.submit")}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
