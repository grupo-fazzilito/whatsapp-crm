'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tour.css';
import { useAuth } from '@/hooks/use-auth';
import { useI18n } from '@/i18n/client';

// Guided tour of the app. Starts by itself the first time a user signs in
// (profiles.tour_completed_at is null) and can be replayed from the top bar.

interface TourValue {
  start: () => void;
}
const TourContext = createContext<TourValue>({ start: () => {} });
export const useTour = () => useContext(TourContext);

/** Anchor → copy key. Steps whose anchor isn't on screen (role, modules, mobile) show centered. */
const STEPS: { key: string; selector?: string; side?: 'left' | 'right' | 'top' | 'bottom' }[] = [
  { key: 'welcome' },
  { key: 'workspace', selector: '[data-tour="workspace-switcher"]', side: 'right' },
  { key: 'dashboard', selector: '[data-tour="nav:/dashboard"]', side: 'right' },
  { key: 'inbox', selector: '[data-tour="nav:/inbox"]', side: 'right' },
  { key: 'contacts', selector: '[data-tour="nav:/contacts"]', side: 'right' },
  { key: 'pipelines', selector: '[data-tour="nav:/pipelines"]', side: 'right' },
  { key: 'channels', selector: '[data-tour="nav:/channels"]', side: 'right' },
  { key: 'agents', selector: '[data-tour="nav:/agents"]', side: 'right' },
  { key: 'business', selector: '[data-tour="nav:business"]', side: 'right' },
  { key: 'reports', selector: '[data-tour="nav:/reports"]', side: 'right' },
  { key: 'settings', selector: '[data-tour="nav:/settings"]', side: 'right' },
  { key: 'tourIcon', selector: '[data-tour="tour-button"]', side: 'bottom' },
  { key: 'help', selector: '[data-tour="help-button"]', side: 'bottom' },
];

function visible(el: Element | null): el is HTMLElement {
  if (!(el instanceof HTMLElement)) return false
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && r.right > 0 && r.left < window.innerWidth;
}

export function TourProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  // An admin viewing the account neither gets the tour nor marks it seen.
  const { profile, profileLoading, refreshProfile, impersonating } = useAuth();
  const pathname = usePathname();
  const autoStarted = useRef(false);

  const markDone = useCallback(async () => {
    if (impersonating) return;
    await fetch('/api/me/tour', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) }).catch(() => {});
    void refreshProfile();
  }, [refreshProfile, impersonating]);

  const start = useCallback(() => {
    const steps: DriveStep[] = [];
    for (const s of STEPS) {
      const el = s.selector ? document.querySelector(s.selector) : null;
      // Missing on this screen/role: skip, except the general ones shown centered.
      if (s.selector && !el) continue;
      steps.push({
        ...(visible(el) ? { element: el } : {}),
        popover: { title: t(`tour.${s.key}.title`), description: t(`tour.${s.key}.body`), side: s.side, align: 'start' },
      });
    }
    const d = driver({
      steps,
      showProgress: true,
      progressText: t('tour.progress'),
      nextBtnText: t('tour.next'),
      prevBtnText: t('tour.prev'),
      doneBtnText: t('tour.done'),
      popoverClass: 'cnx-tour',
      stagePadding: 6,
      stageRadius: 10,
      allowKeyboardControl: true,
      overlayClickBehavior: 'close',
      onDestroyed: () => {
        void markDone();
      },
    });
    d.drive();
  }, [t, markDone]);

  // First sign-in: start once the dashboard has rendered.
  useEffect(() => {
    if (autoStarted.current || profileLoading || !profile || profile.tour_completed_at || impersonating) return;
    if (pathname !== '/dashboard') return;
    autoStarted.current = true;
    const timer = setTimeout(start, 900);
    return () => clearTimeout(timer);
  }, [profile, profileLoading, pathname, start, impersonating]);

  const value = useMemo(() => ({ start }), [start]);
  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}
