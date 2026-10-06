'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { generateSlots, type StaffException } from '../shared';

interface Props {
  value: StaffException[];
  readOnly: boolean;
  onChange: (next: StaffException[]) => void;
}

/** Days off / leave, or a different schedule on one date. */
export function StaffExceptions({ value, readOnly, onChange }: Props) {
  const t = useT();
  const { locale } = useI18n();
  const [draft, setDraft] = useState({ date: '', is_available: false, start: '10:00', end: '14:00', step: 30, reason: '' });

  const add = () => {
    if (!draft.date) {
      toast.error(t('business.setup.special.dateRequired'));
      return;
    }
    if (draft.is_available && draft.end <= draft.start) {
      toast.error(t('business.setup.special.invalidRange'));
      return;
    }
    const entry: StaffException = {
      date: draft.date,
      is_available: draft.is_available,
      reason: draft.reason.trim() || undefined,
      ...(draft.is_available ? { slots: generateSlots(draft.start, draft.end, Math.max(5, draft.step)) } : {}),
    };
    onChange([...value.filter((e) => e.date !== draft.date), entry].sort((a, b) => a.date.localeCompare(b.date)));
    setDraft((d) => ({ ...d, date: '', reason: '' }));
  };

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">{t('business.staff.exceptions.hint')}</p>
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('business.staff.exceptions.empty')}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {value.map((e) => (
            <li key={e.date} className="flex items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{fmtDate(e.date)}</p>
                <p className="text-xs text-muted-foreground">
                  {e.is_available
                    ? t('business.staff.exceptions.customHours', {
                        from: e.slots?.[0]?.start_time ?? '',
                        to: e.slots?.at(-1)?.end_time ?? '',
                      })
                    : t('business.staff.exceptions.off')}
                  {e.reason ? ` · ${e.reason}` : ''}
                </p>
              </div>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('business.common.delete')}
                  onClick={() => onChange(value.filter((x) => x.date !== e.date))}
                >
                  <Trash2 className="size-4" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {!readOnly && (
        <div className="grid gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sx-date">{t('business.setup.special.date')}</Label>
            <Input id="sx-date" type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
            <Switch checked={draft.is_available} onCheckedChange={(v) => setDraft((d) => ({ ...d, is_available: v }))} />
            {t('business.staff.exceptions.worksDifferent')}
          </label>
          {draft.is_available && (
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2">
              <Input
                type="time"
                className="w-28"
                aria-label={t('business.staff.availability.from')}
                value={draft.start}
                onChange={(e) => setDraft((d) => ({ ...d, start: e.target.value }))}
              />
              <Input
                type="time"
                className="w-28"
                aria-label={t('business.staff.availability.to')}
                value={draft.end}
                onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
              />
              <div className="grid gap-1">
                <Label htmlFor="sx-step" className="text-xs">
                  {t('business.staff.availability.slotMinutes')}
                </Label>
                <Input
                  id="sx-step"
                  type="number"
                  min={5}
                  className="w-24"
                  value={draft.step}
                  onChange={(e) => setDraft((d) => ({ ...d, step: Number(e.target.value) }))}
                />
              </div>
            </div>
          )}
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="sx-reason">{t('business.setup.special.reason')}</Label>
            <Input
              id="sx-reason"
              maxLength={120}
              placeholder={t('business.staff.exceptions.reasonPlaceholder')}
              value={draft.reason}
              onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
            />
          </div>
          <div className="sm:col-span-2">
            <Button type="button" variant="outline" onClick={add}>
              <Plus className="size-4" />
              {t('business.common.add')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
