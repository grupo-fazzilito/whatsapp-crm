"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AuthLogo } from "@/components/auth/auth-logo";
import { InteractiveGrid } from "@/components/marketing/interactive-grid";
import { PRESETS } from "@/lib/industries";
import { COUNTRIES, countryDefaults } from "@/lib/workspace/countries";
import { useI18n } from "@/i18n/client";

const fieldCls =
  "h-9.5 w-full border border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] rounded-lg px-3 outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";

/** Business details for an account created with Google / Facebook. */
export function WelcomeForm() {
  const { locale, t } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [industry, setIndustry] = useState("");
  const [country, setCountry] = useState("MX");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!industry) {
      setError(t("authPages.signup.selectBusinessType"));
      return;
    }
    setError(null);
    setLoading(true);
    const defaults = countryDefaults(country);
    const res = await fetch("/api/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        industry,
        country,
        currency: defaults.currency,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || defaults.timezone,
        locale,
      }),
    }).catch(() => null);
    if (!res?.ok) {
      setError(t("authPages.welcome.failed"));
      setLoading(false);
      return;
    }
    router.replace("/dashboard");
    router.refresh();
  };

  const signOut = async () => {
    await authClient.signOut();
    router.replace("/login");
  };

  return (
    <div className="relative flex w-full flex-1 flex-col items-center justify-center gap-6 px-4 py-12 min-h-[calc(100dvh-4rem)]">
      <InteractiveGrid gridSize={40} className="opacity-20" />
      <AuthLogo />
      <Card className="w-full max-w-md border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] shadow-[var(--m-shadow-card)] backdrop-blur-xl relative z-10 p-2">
        <CardHeader className="items-center text-center pb-3 pt-6">
          <CardTitle className="text-xl font-bold tracking-tight text-[var(--m-text-heading)] flex items-center gap-1.5 justify-center">
            {t("authPages.welcome.title")} <Sparkles className="size-4 text-emerald-400" aria-hidden />
          </CardTitle>
          <CardDescription className="text-xs text-[var(--m-text-tertiary)] mt-1">{t("authPages.welcome.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-2">
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && (
              <div role="alert" className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
                {error}
              </div>
            )}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="welcome-name" className="text-xs font-bold text-[var(--m-text-secondary)]">
                {t("authPages.welcome.businessName")}
              </Label>
              <Input
                id="welcome-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("authPages.welcome.businessNamePlaceholder")}
                required
                maxLength={120}
                className={`${fieldCls} placeholder:text-[var(--m-text-muted)]`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="welcome-industry" className="text-xs font-bold text-[var(--m-text-secondary)]">
                {t("authPages.welcome.businessType")}
              </Label>
              <select id="welcome-industry" value={industry} onChange={(e) => setIndustry(e.target.value)} required className={fieldCls}>
                <option value="" disabled>
                  {t("authPages.welcome.businessTypePlaceholder")}
                </option>
                {PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name[locale]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="welcome-country" className="text-xs font-bold text-[var(--m-text-secondary)]">
                {t("authPages.welcome.country")}
              </Label>
              <select id="welcome-country" value={country} onChange={(e) => setCountry(e.target.value)} className={fieldCls}>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name[locale]} ({c.currency})
                  </option>
                ))}
              </select>
            </div>
            <Button
              type="submit"
              disabled={loading || !name.trim()}
              className="mt-2 h-10 w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-bold text-xs disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {t("authPages.welcome.creating")}
                </span>
              ) : (
                t("authPages.welcome.submit")
              )}
            </Button>
          </form>
          <button type="button" onClick={() => void signOut()} className="mt-4 w-full text-center text-[11px] text-[var(--m-text-muted)] hover:text-[var(--m-text-primary)] underline-offset-2 hover:underline">
            {t("authPages.welcome.signOut")}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
