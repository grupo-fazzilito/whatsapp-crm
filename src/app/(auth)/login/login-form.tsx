"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authClient } from "@/lib/auth/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, Sparkles, Eye, EyeOff, Loader2 } from "lucide-react";
import { InteractiveGrid } from "@/components/marketing/interactive-grid";
import { useTheme } from "@/hooks/use-theme";
import { useI18n } from "@/i18n/client";
import { SocialButtons } from "@/components/auth/social-buttons";
import type { SocialProvider } from "@/lib/auth/server";

export function LoginForm({ providers, socialError, next }: { providers: SocialProvider[]; socialError: boolean; next: string | null }) {
  const { mode } = useTheme();
  const isLight = mode === "light";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(socialError ? t("authPages.social.error") : null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await authClient.signIn.email({ email, password });

    if (error) {
      setError(error.status === 401 || error.status === 403 ? t("authPages.login.invalidCredentials") : (error.message ?? t("authPages.login.failed")));
      setLoading(false);
      return;
    }

    // Honor ?next= for same-site paths only (e.g. back to an invitation).
    router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard");
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[var(--m-bg-primary)] px-4 overflow-hidden select-none">
      {/* Decorative Grids and Blurs */}
      <InteractiveGrid gridSize={40} className="opacity-20" />
      <div className="absolute top-[20%] left-[20%] w-[50%] h-[50%] rounded-full bg-emerald-500/5 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[20%] right-[20%] w-[50%] h-[50%] rounded-full bg-teal-500/5 blur-[120px] pointer-events-none" />

      {/* Floating Home Link */}
      <Link
        href="/"
        className="absolute top-6 left-6 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--m-text-tertiary)] hover:text-[var(--m-text-primary)] transition-colors bg-[var(--m-bg-secondary)]/60 border border-[var(--m-border-glass)] px-3 py-1.5 rounded-lg backdrop-blur"
      >
        <ArrowLeft className="size-3.5" /> {t("authPages.common.backHome")}
      </Link>

      <Card className="w-full max-w-md border-[var(--m-border-primary)] bg-[var(--m-bg-glass)] shadow-[var(--m-shadow-card)] backdrop-blur-xl relative z-10 p-2 overflow-hidden transition-all duration-300">
        <CardHeader className="items-center text-center pb-3 pt-6">
          <CardTitle className="text-xl font-bold tracking-tight text-[var(--m-text-heading)] flex items-center gap-1.5 justify-center">
            {t("authPages.login.title")} <Sparkles className="size-4 text-emerald-400" />
          </CardTitle>
          <CardDescription className="text-xs text-[var(--m-text-tertiary)] mt-1">
            {t("authPages.login.subtitle")}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-6 pb-6 pt-2">
          <SocialButtons providers={providers} next={next} mode="login" />
          <form onSubmit={handleLogin} className="flex flex-col gap-4">
            {error && (
              <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-2.5 text-xs text-red-400">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email" className="text-xs font-bold text-[var(--m-text-secondary)]">
                {t("authPages.common.emailAddress")}
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="h-9.5 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 px-3 rounded-lg"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-bold text-[var(--m-text-secondary)]">
                  {t("authPages.common.password")}
                </Label>
                <Link
                  href="/forgot-password"
                  className="text-[11px] text-emerald-500 hover:text-emerald-400 font-semibold"
                >
                  {t("authPages.login.forgot")}
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-9.5 border-[var(--m-input-border)] bg-[var(--m-input-bg)] text-xs text-[var(--m-text-primary)] placeholder:text-[var(--m-text-muted)] focus-visible:border-emerald-500 focus-visible:ring-emerald-500/20 pr-10 px-3 rounded-lg"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-400"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="mt-2 h-10 w-full bg-emerald-500 text-slate-950 hover:bg-emerald-400 hover:scale-[1.005] active:scale-[0.995] font-bold text-xs transition-all shadow-[0_0_12px_rgba(16,185,129,0.18)] disabled:opacity-50"
            >
              {loading ? (
                <span className="flex items-center gap-2 justify-center">
                  <Loader2 className="h-4 w-4 animate-spin" /> {t("authPages.login.authenticating")}
                </span>
              ) : (
                t("authPages.login.submit")
              )}
            </Button>
          </form>

          <p className="mt-5 text-center text-xs text-[var(--m-text-muted)]">
            {t("authPages.login.noAccount")}{" "}
            <Link
              href="/signup"
              className="text-emerald-500 hover:text-emerald-400 font-bold"
            >
              {t("authPages.login.createAccount")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
