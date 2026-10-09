'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Save, Trash2 } from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { api } from '../api';
import type { Workspace } from '@/lib/workspace/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DAYS, LoadingBlock, trimOrNull } from '../shared';

interface DayRow {
  day_name: string;
  opening_time: string;
  closing_time: string;
  is_closed: boolean;
  has_break: boolean;
  break_start: string;
  break_end: string;
}

type DateException = Workspace['date_exceptions'][number];

const defaultDay = (day: string): DayRow => ({
  day_name: day,
  opening_time: '09:00',
  closing_time: '18:00',
  is_closed: day === 'Sunday',
  has_break: false,
  break_start: '14:00',
  break_end: '15:00',
});

/** Localized weekday name for a stored English day name. */
export function useDayLabel() {
  const { locale } = useI18n();
  return (day: string) => {
    const idx = DAYS.indexOf(day as (typeof DAYS)[number]);
    if (idx < 0) return day;
    // 2024-01-01 was a Monday.
    const d = new Date(Date.UTC(2024, 0, 1 + idx));
    const s = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' }).format(d);
    return s.charAt(0).toUpperCase() + s.slice(1);
  };
}

export function HoursForm({ workspace, readOnly }: { workspace: Workspace; readOnly: boolean }) {
  const t = useT();
  const dayLabel = useDayLabel();
  const [rows, setRows] = useState<DayRow[]>(() => DAYS.map(defaultDay));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    api<{ hours: { day_name: string; opening_time: string | null; closing_time: string | null; is_closed: boolean | null; break_start: string | null; break_end: string | null }[] }>(
      '/api/business/hours',
    )
      .then(({ hours: data }) => {
        if (!alive) return;
        if (data.length) {
          setRows(
            DAYS.map((day) => {
              const r = data.find((x) => x.day_name === day);
              if (!r) return defaultDay(day);
              return {
                day_name: day,
                opening_time: r.opening_time || '09:00',
                closing_time: r.closing_time || '18:00',
                is_closed: !!r.is_closed,
                has_break: !!(r.break_start && r.break_end),
                break_start: r.break_start || '14:00',
                break_end: r.break_end || '15:00',
              };
            }),
          );
        }
      })
      .catch((err: Error) => {
        if (alive) toast.error(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const update = (i: number, patch: Partial<DayRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    for (const r of rows) {
      if (r.is_closed) continue;
      if (r.closing_time <= r.opening_time) {
        toast.error(t('business.setup.hours.invalidRange', { day: dayLabel(r.day_name) }));
        return;
      }
      if (r.has_break && (r.break_end <= r.break_start || r.break_start <= r.opening_time || r.break_end >= r.closing_time)) {
        toast.error(t('business.setup.hours.invalidBreak', { day: dayLabel(r.day_name) }));
        return;
      }
    }
    setSaving(true);
    try {
      // The server drops the AI's cached business context.
      await api('/api/business/hours', {
        method: 'PUT',
        body: {
          hours: rows.map((r) => ({
            day_name: r.day_name,
            opening_time: r.opening_time,
            closing_time: r.closing_time,
            is_closed: r.is_closed,
            break_start: r.has_break ? r.break_start : null,
            break_end: r.has_break ? r.break_end : null,
          })),
        },
      });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setSaving(false);
    toast.success(t('business.common.saved'));
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('business.setup.hours.title')}</CardTitle>
          <CardDescription>{t('business.setup.hours.description', { tz: workspace.timezone })}</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <LoadingBlock />
          ) : (
            <div className="divide-y divide-border">
              {rows.map((r, i) => (
                <div key={r.day_name} className="flex flex-col gap-3 py-3 lg:flex-row lg:items-center">
                  <div className="flex w-full items-center justify-between gap-3 lg:w-48">
                    <span className="text-sm font-medium text-foreground">{dayLabel(r.day_name)}</span>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Switch
                        checked={!r.is_closed}
                        disabled={readOnly}
                        aria-label={t('business.setup.hours.openToggle', { day: dayLabel(r.day_name) })}
                        onCheckedChange={(v) => update(i, { is_closed: !v })}
                      />
                      {r.is_closed ? t('business.setup.hours.closed') : t('business.setup.hours.open')}
                    </label>
                  </div>
                  {!r.is_closed && (
                    <div className="flex flex-1 flex-wrap items-center gap-2">
                      <Input
                        type="time"
                        className="w-28"
                        aria-label={t('business.setup.hours.opensAt')}
                        value={r.opening_time}
                        disabled={readOnly}
                        onChange={(e) => update(i, { opening_time: e.target.value })}
                      />
                      <span className="text-xs text-muted-foreground">–</span>
                      <Input
                        type="time"
                        className="w-28"
                        aria-label={t('business.setup.hours.closesAt')}
                        value={r.closing_time}
                        disabled={readOnly}
                        onChange={(e) => update(i, { closing_time: e.target.value })}
                      />
                      <label className="ml-0 flex items-center gap-2 text-xs text-muted-foreground lg:ml-4">
                        <Switch
                          checked={r.has_break}
                          disabled={readOnly}
                          aria-label={t('business.setup.hours.break')}
                          onCheckedChange={(v) => update(i, { has_break: v })}
                        />
                        {t('business.setup.hours.break')}
                      </label>
                      {r.has_break && (
                        <>
                          <Input
                            type="time"
                            className="w-28"
                            aria-label={t('business.setup.hours.breakStart')}
                            value={r.break_start}
                            disabled={readOnly}
                            onChange={(e) => update(i, { break_start: e.target.value })}
                          />
                          <span className="text-xs text-muted-foreground">–</span>
                          <Input
                            type="time"
                            className="w-28"
                            aria-label={t('business.setup.hours.breakEnd')}
                            value={r.break_end}
                            disabled={readOnly}
                            onChange={(e) => update(i, { break_end: e.target.value })}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {!readOnly && !loading && (
            <div className="mt-4 flex justify-end">
              <Button type="button" onClick={save} disabled={saving}>
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                {t('business.common.save')}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <SpecialDates workspace={workspace} readOnly={readOnly} />
    </div>
  );
}

function SpecialDates({ workspace, readOnly }: { workspace: Workspace; readOnly: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const { refresh } = useWorkspace();
  const [list, setList] = useState<DateException[]>(() =>
    [...(workspace.date_exceptions ?? [])].sort((a, b) => a.date.localeCompare(b.date)),
  );
  const [draft, setDraft] = useState({ date: '', is_closed: true, opening_time: '09:00', closing_time: '14:00', reason: '' });
  const [saving, setSaving] = useState(false);

  const persist = async (next: DateException[]) => {
    setSaving(true);
    try {
      await api('/api/business/workspace', { method: 'PATCH', body: { date_exceptions: next } });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : String(err));
      return false;
    }
    setSaving(false);
    setList(next);
    await refresh();
    toast.success(t('business.common.saved'));
    return true;
  };

  const add = async () => {
    if (!draft.date) {
      toast.error(t('business.setup.special.dateRequired'));
      return;
    }
    if (!draft.is_closed && draft.closing_time <= draft.opening_time) {
      toast.error(t('business.setup.special.invalidRange'));
      return;
    }
    const entry: DateException = {
      date: draft.date,
      is_closed: draft.is_closed,
      opening_time: draft.is_closed ? null : draft.opening_time,
      closing_time: draft.is_closed ? null : draft.closing_time,
      reason: trimOrNull(draft.reason),
    };
    const next = [...list.filter((e) => e.date !== draft.date), entry].sort((a, b) => a.date.localeCompare(b.date));
    if (await persist(next)) setDraft((d) => ({ ...d, date: '', reason: '' }));
  };

  const fmtDate = (d: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('business.setup.special.title')}</CardTitle>
        <CardDescription>{t('business.setup.special.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('business.setup.special.empty')}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.map((e) => (
              <li key={e.date} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{fmtDate(e.date)}</p>
                  <p className="text-xs text-muted-foreground">
                    {e.is_closed
                      ? t('business.setup.special.closedAllDay')
                      : t('business.setup.special.openFromTo', { from: e.opening_time ?? '', to: e.closing_time ?? '' })}
                    {e.reason ? ` · ${e.reason}` : ''}
                  </p>
                </div>
                {!readOnly && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={saving}
                    aria-label={t('business.common.delete')}
                    onClick={() => persist(list.filter((x) => x.date !== e.date))}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <div className="grid gap-3 rounded-lg border border-dashed border-border p-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
            <div className="grid gap-1.5">
              <Label htmlFor="sd-date">{t('business.setup.special.date')}</Label>
              <Input id="sd-date" type="date" value={draft.date} onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground lg:pb-2">
              <Switch checked={draft.is_closed} onCheckedChange={(v) => setDraft((d) => ({ ...d, is_closed: v }))} />
              {t('business.setup.special.closed')}
            </label>
            {!draft.is_closed ? (
              <div className="flex items-center gap-2">
                <Input
                  type="time"
                  aria-label={t('business.setup.hours.opensAt')}
                  value={draft.opening_time}
                  onChange={(e) => setDraft((d) => ({ ...d, opening_time: e.target.value }))}
                />
                <Input
                  type="time"
                  aria-label={t('business.setup.hours.closesAt')}
                  value={draft.closing_time}
                  onChange={(e) => setDraft((d) => ({ ...d, closing_time: e.target.value }))}
                />
              </div>
            ) : (
              <span className="hidden lg:block" />
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="sd-reason">{t('business.setup.special.reason')}</Label>
              <Input
                id="sd-reason"
                maxLength={120}
                placeholder={t('business.setup.special.reasonPlaceholder')}
                value={draft.reason}
                onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value }))}
              />
            </div>
            <Button type="button" onClick={add} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />}
              {t('business.common.add')}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
