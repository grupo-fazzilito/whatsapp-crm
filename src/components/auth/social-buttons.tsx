"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { useI18n } from "@/i18n/client";
import type { SocialProvider } from "@/lib/auth/server";

function GoogleLogo() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function FacebookLogo() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
      <path fill="currentColor" d="M24 12.07C24 5.41 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.04V9.41c0-3.02 1.8-4.7 4.54-4.7 1.31 0 2.68.24 2.68.24v2.97h-1.5c-1.5 0-1.96.93-1.96 1.89v2.26h3.32l-.53 3.5h-2.8V24C19.62 23.1 24 18.1 24 12.07z" />
    </svg>
  );
}

/**
 * "Continue with Google / Facebook". New accounts land on /welcome to
 * create their business; existing ones go to `next` (or the dashboard).
 */
export function SocialButtons({ providers, next, mode }: { providers: SocialProvider[]; next?: string | null; mode: "login" | "signup" }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState<SocialProvider | null>(null);
  if (providers.length === 0) return null;

  const go = async (provider: SocialProvider) => {
    setBusy(provider);
    const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
    const { error } = await authClient.signIn.social({
      provider,
      callbackURL: safeNext,
      newUserCallbackURL: "/welcome",
      errorCallbackURL: `/${mode}?social_error=1`,
    });
    if (error) setBusy(null);
  };

  const base =
    "flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-bold transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-60";

  return (
    <div className="flex flex-col gap-2.5">
      {providers.includes("google") && (
        <button type="button" onClick={() => void go("google")} disabled={!!busy} className={`${base} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50`}>
          {busy === "google" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <GoogleLogo />}
          {t("authPages.social.google")}
        </button>
      )}
      {providers.includes("facebook") && (
        <button type="button" onClick={() => void go("facebook")} disabled={!!busy} className={`${base} bg-[#1877F2] text-white hover:bg-[#166FE5]`}>
          {busy === "facebook" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <FacebookLogo />}
          {t("authPages.social.facebook")}
        </button>
      )}
      <div className="my-1.5 flex items-center gap-3 text-[11px] text-[var(--m-text-muted)]">
        <span className="h-px flex-1 bg-[var(--m-border-primary)]" />
        {t("authPages.social.divider")}
        <span className="h-px flex-1 bg-[var(--m-border-primary)]" />
      </div>
    </div>
  );
}
