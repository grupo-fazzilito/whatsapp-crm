"use client";

import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { useLocalePath } from "@/i18n/client";

/** Whasalia logo above the login / signup cards. */
export function AuthLogo() {
  const lp = useLocalePath();
  return (
    <Link href={lp("/")} className="relative z-10 inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/60">
      <Logo className="h-12" />
    </Link>
  );
}
