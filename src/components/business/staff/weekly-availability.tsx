'use client';

import { useState } from 'react';
import { Plus, Wand2, X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DAYS, generateSlots, type StaffSlot } from '../shared';
import { useDayLabel } from '../setup/hours-form';
import type { StaffDraft } from './staff-editor';

type Patch = Partial<Pick<StaffDraft, 'available_days' | 'available_start_time' | 'available_end_time' | 'weekly_slots'>>;

interface Props {
  draft: StaffDraft;
  readOnly: boolean;
  onChange: (patch: Patch) => void;
}

export function WeeklyAvailability({ draft, readOnly, onChange }: Props) {
  const t = useT();
  const dayLabel = useDayLabel();
  const [day, setDay] = useState<string>(draft.available_days[0] ?? 'Monday');
  const [duration, setDuration] = useState(30);
  const [custom, setCustom] = useState({ start_time: '09:00', end_time: '09:30' });

  const slots = draft.weekly_slots[day] ?? [];
  const setDaySlots = (next: StaffSlot[]) => {
    const sorted = [...next].sort((a, b) => a.start_time.localeCompare(b.start_time));
    onChange({ weekly_slots: { ...draft.weekly_slots, [day]: sorted } });
  };

  const toggleDay = (d: string) => {
    const on = draft.available_days.includes(d);
    onChange({ available_days: on ? draft.available_days.filter((x) => x !== d) : [...draft.available_days, d] });
  };

  return (
    <div className="grid gap-5">
      <div className="grid gap-2">
        <Label>{t('business.staff.availability.days')}</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d) => {
            const on = draft.available_days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                disabled={readOnly}
                onClick={() => toggleDay(d)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed',
                  on ? 'border-primary bg-primary text-primary-foreground' : 'border-border text-muted-foreground hover:bg-muted',
                )}
              >
                {dayLabel(d)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:max-w-sm">
        <div className="grid gap-1.5">
          <Label htmlFor="st-start">{t('business.staff.availability.from')}</Label>
          <Input
            id="st-start"
            type="time"
            value={draft.available_start_time}
            disabled={readOnly}
            onChange={(e) => onChange({ available_start_time: e.target.value })}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="st-end">{t('business.staff.availability.to')}</Label>
          <Input
            id="st-end"
            type="time"
            value={draft.available_end_time}
            disabled={readOnly}
            onChange={(e) => onChange({ available_end_time: e.target.value })}
          />
        </div>
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">{t('business.staff.availability.shiftHint')}</p>

      <div className="grid gap-3 rounded-lg border border-border p-3">
        <div>
          <h4 className="text-sm font-semibold text-foreground">{t('business.staff.availability.fixedTitle')}</h4>
          <p className="text-xs text-muted-foreground">{t('business.staff.availability.fixedHint')}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((d) => {
            const count = draft.weekly_slots[d]?.length ?? 0;
            return (
              <button
                key={d}
                type="button"
                onClick={() => setDay(d)}
                className={cn(
                  'rounded-md px-2.5 py-1 text-xs font-medium',
                  day === d ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                {dayLabel(d).slice(0, 3)}
                {count > 0 && <span className="ml-1 opacity-70">({count})</span>}
              </button>
            );
          })}
        </div>

        {slots.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('business.staff.availability.noFixed', { day: dayLabel(day) })}</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {slots.map((s, i) => (
              <span
                key={`${s.start_time}-${i}`}
                className={cn(
                  'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs',
                  s.is_active === false ? 'border-dashed border-border text-muted-foreground line-through' : 'border-border text-foreground',
                )}
              >
                <button
                  type="button"
                  disabled={readOnly}
                  title={t('business.staff.availability.toggleSlot')}
                  onClick={() => setDaySlots(slots.map((x, j) => (j === i ? { ...x, is_active: x.is_active === false } : x)))}
                >
                  {s.start_time}
                  {s.end_time ? `–${s.end_time}` : ''}
                </button>
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={t('business.common.delete')}
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => setDaySlots(slots.filter((_, j) => j !== i))}
                  >
                    <X className="size-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {!readOnly && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="st-dur" className="text-xs">
                {t('business.staff.availability.slotMinutes')}
              </Label>
              <Input
                id="st-dur"
                type="number"
                min={5}
                max={480}
                className="w-24"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
              />
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDaySlots(generateSlots(draft.available_start_time, draft.available_end_time, duration))}
            >
              <Wand2 className="size-3.5" />
              {t('business.staff.availability.generate')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const all = Object.fromEntries(
                  draft.available_days.map((d) => [d, generateSlots(draft.available_start_time, draft.available_end_time, duration)]),
                );
                onChange({ weekly_slots: { ...draft.weekly_slots, ...all } });
              }}
            >
              {t('business.staff.availability.generateAll')}
            </Button>
            {slots.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => setDaySlots([])}>
                {t('business.staff.availability.clear')}
              </Button>
            )}
            <span className="mx-1 hidden h-6 w-px bg-border sm:block" />
            <Input
              type="time"
              className="w-28"
              aria-label={t('business.staff.availability.from')}
              value={custom.start_time}
              onChange={(e) => setCustom((c) => ({ ...c, start_time: e.target.value }))}
            />
            <Input
              type="time"
              className="w-28"
              aria-label={t('business.staff.availability.to')}
              value={custom.end_time}
              onChange={(e) => setCustom((c) => ({ ...c, end_time: e.target.value }))}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!custom.start_time || custom.end_time <= custom.start_time}
              onClick={() =>
                setDaySlots([...slots.filter((s) => s.start_time !== custom.start_time), { ...custom, is_active: true }])
              }
            >
              <Plus className="size-3.5" />
              {t('business.staff.availability.addSlot')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
