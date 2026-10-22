"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ChevronDown, Menu, X, Sparkles } from "lucide-react";
import { authClient } from "@/lib/auth/client";
import { useMarketingTheme } from "@/components/marketing/marketing-theme-provider";
import { ThemeToggle } from "./theme-toggle";
import { MagneticButton } from "./magnetic-button";
import { cn } from "@/lib/utils";
import { useI18n, useLocalePath } from "@/i18n/client";
import { LanguageSwitcher } from "@/components/language-switcher";

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
function clamp01(v: number) { return Math.min(1, Math.max(0, v)); }
const SCROLL_RANGE = 120;

export function GlassNavbar() {
  const pathname = usePathname();
  const { t } = useI18n();
  const lp = useLocalePath();
  const [isOpen, setIsOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const { resolvedTheme } = useMarketingTheme();
  const isLight = resolvedTheme === "light";
  const rafRef = useRef<number | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkUser = async () => {
      const { data } = await authClient.getSession();
      setIsLoggedIn(!!data?.session);
    };
    checkUser();

    const onScroll = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setProgress(clamp01(window.scrollY / SCROLL_RANGE));
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    const onClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);

    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("mousedown", onClickOutside);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const navLinks = [
    { name: t("mktShell.nav.home"), href: lp("/") },
    { name: t("mktShell.nav.features"), href: lp("/features") },
    { name: t("mktShell.nav.aiAutomation"), href: lp("/ai-automation") },
    { name: t("mktShell.nav.pricing"), href: lp("/pricing") },
  ];

  const dropdownLinks = [
    { name: t("mktShell.nav.sharedInbox"), href: lp("/shared-team-inbox") },
    { name: t("mktShell.nav.crm"), href: lp("/crm") },
    { name: t("mktShell.nav.analytics"), href: lp("/analytics") },
    { name: t("mktShell.nav.enterprise"), href: lp("/enterprise") },
    { name: t("mktShell.nav.security"), href: lp("/security") },
    { name: t("mktShell.nav.stories"), href: lp("/customer-stories") },
    { name: t("mktShell.nav.about"), href: lp("/about-us") },
    { name: t("mktShell.nav.careers"), href: lp("/careers") },
    { name: t("mktShell.nav.blog"), href: lp("/blog") },
  ];

  const maxWidth    = lerp(1152, 920,  progress);
  const radius      = lerp(14,   9999, progress);
  const padV        = lerp(6,    10,   progress);
  const padH        = lerp(8,    22,   progress);
  const bgAlpha     = lerp(0, isLight ? 0.92 : 0.85, progress);
  const borderAlpha = lerp(0, isLight ? 0.65 : 0.55, progress);
  const shadowAlpha = lerp(0, isLight ? 0.07 : 0.50, progress);
  const shadowBlur  = lerp(0, 28, progress);
  const topPx       = lerp(16, 12, progress);

  const pillStyle: React.CSSProperties = {
    width: "100%",
    maxWidth: `${maxWidth}px`,
    borderRadius: `${radius}px`,
    padding: `${padV}px ${padH}px`,
    backgroundColor: isLight
      ? `rgba(255,255,255,${bgAlpha})`
      : `rgba(2,6,23,${bgAlpha})`,
    border: `1px solid ${
      isLight
        ? `rgba(203,213,225,${borderAlpha})`
        : `rgba(30,41,59,${borderAlpha})`
    }`,
    boxShadow: `0 4px ${shadowBlur}px rgba(0,0,0,${shadowAlpha})`,
    backdropFilter: progress > 0.05 ? "blur(20px)" : "none",
    WebkitBackdropFilter: progress > 0.05 ? "blur(20px)" : "none",
  };

  const linkCls = "text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)]";

  return (
    <>
      <header
        className="fixed inset-x-0 z-50 flex justify-center pointer-events-none px-4 sm:px-6"
        style={{ top: `${topPx}px` }}
      >
        <div
          className="pointer-events-auto flex items-center justify-between"
          style={pillStyle}
        >
          {/* Brand */}
          <Link href={lp("/")} className="flex items-center gap-2 group shrink-0">
            <img
              src={isLight ? "/images/logo/whasalia-logo-light.png" : "/images/logo/whasalia-logo.png"}
              alt="Whasalia"
              className="h-10 w-auto object-contain group-hover:scale-110 transition-transform"
            />
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-6">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-[11px] font-semibold tracking-wide transition-colors duration-200 whitespace-nowrap",
                  pathname === link.href ? "text-emerald-500" : linkCls
                )}
              >
                {link.name}
              </Link>
            ))}
          </nav>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-2.5 shrink-0">
            <LanguageSwitcher variant="marketing" />
            <ThemeToggle />
            {!isLoggedIn && (
              <Link href="/login" className={cn("text-[11px] font-semibold transition-colors px-3 py-1.5 whitespace-nowrap", linkCls)}>
                {t("mktShell.signIn")}
              </Link>
            )}
            <MagneticButton>
              <Link
                href={isLoggedIn ? "/dashboard" : "/signup"}
                className="text-[11px] font-semibold bg-[#00DF82] hover:bg-[#00c673] text-slate-950 px-4 py-1.5 rounded-full transition-all shadow-[0_2px_12px_rgba(0,223,130,0.2)] whitespace-nowrap"
              >
                {isLoggedIn ? t("mktShell.dashboard") : t("mktShell.signUp")}
              </Link>
            </MagneticButton>
          </div>

          {/* Mobile toggle */}
          <button
            onClick={() => setIsOpen((v) => !v)}
            aria-label={t("mktShell.menu")}
            className="md:hidden w-8 h-8 rounded-full border flex items-center justify-center transition-colors bg-[var(--m-bg-secondary)] border-[var(--m-border-primary)] text-[var(--m-text-secondary)] hover:text-[var(--m-text-heading)]"
          >
            {isOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </header>

      {/* Mobile drawer */}
      {isOpen && (
        <div className="fixed inset-0 top-[68px] z-40 p-6 flex flex-col justify-between md:hidden bg-[var(--m-bg-secondary)] border-t border-[var(--m-border-primary)] backdrop-blur-xl">
          <div className="space-y-6">
            <div className="flex flex-col gap-4">
              <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)]">
                {t("mktShell.navigation")}
              </span>
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setIsOpen(false)}
                  className="text-sm font-bold transition-colors text-[var(--m-text-primary)] hover:text-emerald-500"
                >
                  {link.name}
                </Link>
              ))}
            </div>
            <div className="flex flex-col gap-3">
              <span className="text-[10px] uppercase font-bold tracking-widest text-[var(--m-text-muted)]">
                {t("mktShell.solutions")}
              </span>
              <div className="grid grid-cols-2 gap-3">
                {dropdownLinks.slice(0, 6).map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setIsOpen(false)}
                    className="text-xs font-semibold transition-colors text-[var(--m-text-secondary)] hover:text-emerald-500"
                  >
                    {link.name}
                  </Link>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 mt-8">
            <div className="flex items-center justify-center gap-3 py-1">
              <LanguageSwitcher variant="marketing" />
              <ThemeToggle className="flex-1 justify-around" />
            </div>
            {!isLoggedIn && (
              <Link
                href="/login"
                onClick={() => setIsOpen(false)}
                className="w-full text-center text-xs font-bold py-3 rounded-full border transition-colors border-[var(--m-border-primary)] bg-[var(--m-bg-tertiary)] text-[var(--m-text-primary)]"
              >
                {t("mktShell.signIn")}
              </Link>
            )}
            <Link
              href={isLoggedIn ? "/dashboard" : "/signup"}
              onClick={() => setIsOpen(false)}
              className="w-full text-center text-xs font-semibold bg-[#00DF82] text-slate-950 py-3 rounded-full hover:bg-[#00c673] transition-colors"
            >
              {isLoggedIn ? t("mktShell.dashboard") : t("mktShell.signUp")}
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
