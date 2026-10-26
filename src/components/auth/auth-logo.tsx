"use client";

import Link from "next/link";
import { useMarketingTheme } from "@/components/marketing/marketing-theme-provider";
import { useLocalePath } from "@/i18n/client";

/** Whasalia logo above the login / signup cards (light or dark version per theme). */
export function AuthLogo() {
  const { resolvedTheme } = useMarketingTheme();
  const lp = useLocalePath();
  return (
    <Link href={lp("/")} className="relative z-10 inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
      {/* eslint-disable-next-line @next/next/no-img-element -- same static logo as the navbar */}
      <img
        src={resolvedTheme === "light" ? "/images/logo/whasalia-logo-light.png" : "/images/logo/whasalia-logo.png"}
        alt="Whasalia"
        width={152}
        height={48}
        className="h-12 w-auto"
      />
    </Link>
  );
}
