'use client';

import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Stored day names (business_hours.day_name, staff.available_days). */
export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
export type DayName = (typeof DAYS)[number];

export const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60';

export interface StaffSlot {
  start_time: string;
  end_time?: string | null;
  is_active?: boolean;
}

export interface StaffException {
  date: string;
  is_available: boolean;
  slots?: StaffSlot[];
  reason?: string;
}

export interface Staff {
  id: string;
  name: string;
  title: string | null;
  qualification: string | null;
  experience: string | null;
  fee: number | null;
  languages: string | null;
  photo_url: string | null;
  bio: string | null;
  email: string | null;
  phone: string | null;
  is_active: boolean;
  member_user_id: string | null;
  available_days: string[] | null;
  available_start_time: string | null;
  available_end_time: string | null;
  weekly_slots: Record<string, StaffSlot[]> | null;
  date_exceptions: StaffException[] | null;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  price: number | null;
  price_is_from: boolean;
  duration_minutes: number | null;
  is_active: boolean;
}

export interface Faq {
  id: string;
  question: string;
  answer: string;
  keywords: string | null;
  ai_agent_ids: string[] | null;
}

export interface AgentRef {
  id: string;
  name: string;
}

/** Intents the AI engine writes to ai_chat_logs.detected_intent. */
export const INTENTS = [
  'greeting',
  'faq',
  'business_info',
  'service_info',
  'pricing',
  'availability',
  'booking',
  'cancel_booking',
  'catalog',
  'order',
  'handover',
  'transfer',
  'emergency',
  'after_hours',
  'farewell',
  'other',
] as const;

export const BOOKING_STATUSES = ['pending', 'confirmed', 'completed', 'cancelled', 'no_show'] as const;

/** Drop the AI's cached business context so agents see changes now. */
export function invalidateAi() {
  return fetch('/api/business/invalidate-cache', { method: 'POST' }).catch(() => undefined);
}

/** Fixed start times every `duration` minutes between two HH:MM times. */
export function generateSlots(start: string, end: string, duration: number): StaffSlot[] {
  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + (m || 0);
  };
  const fmt = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  if (!start || !end || duration < 5) return [];
  const out: StaffSlot[] = [];
  for (let s = toMin(start); s + duration <= toMin(end); s += duration) {
    out.push({ start_time: fmt(s), end_time: fmt(s + duration), is_active: true });
  }
  return out;
}

/** Regional locale for currency formatting ('es' + 'CO' → 'es-CO' shows "$ 350"). */
export function moneyLocale(locale: string, country: string | null | undefined) {
  return country && /^[A-Z]{2}$/.test(country) ? `${locale}-${country}` : locale;
}

export const trimOrNull = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Notice({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground', className)}>{children}</p>
  );
}

export function LoadingBlock() {
  return (
    <div className="flex justify-center py-16">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      {description && <p className="max-w-md text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
