'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { HelpCircle, Loader2, Save } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { api } from '../api';
import { selectClass } from '../shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { bookingDefaults, DURATION_OPTIONS, STEP_OPTIONS } from '@/lib/bookings/defaults';
import type { Workspace } from '@/lib/workspace/types';

/**
 * Business setup → Hours: how long a booking without a service lasts and
 * every how many minutes bookings may start. Short on screen; the full
 * explanation opens in «¿Cómo funciona?».
 */
export function BookingTimesCard({ workspace, readOnly }: { workspace: Workspace; readOnly: boolean }) {
  const t = useT();
  const { refresh } = useWorkspace();
  const saved = bookingDefaults(workspace.settings);
  const [duration, setDuration] = useState(saved.duration);
  const [step, setStep] = useState(saved.step);
  const [saving, setSaving] = useState(false);
  const [help, setHelp] = useState(false);
  const k = (key: string, v?: Record<string, string | number>) => t(`business.setup.bookingTimes.${key}`, v);
  const changed = duration !== saved.duration || step !== saved.step;

  const save = async () => {
    setSaving(true);
    try {
      // The server drops the AI's cached business context.
      await api('/api/business/workspace', { method: 'PATCH', body: { settings: { booking_default_duration: duration, booking_step: step } } });
      await refresh();
      toast.success(t('business.common.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center justify-between gap-2">
          {k('title')}
          <Button type="button" variant="ghost" size="sm" className="text-primary" onClick={() => setHelp(true)}>
            <HelpCircle className="size-4" aria-hidden /> {k('how')}
          </Button>
        </CardTitle>
        <CardDescription>{k('description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <Label htmlFor="bt-duration">{k('duration')}</Label>
          <select id="bt-duration" className={selectClass} value={duration} disabled={readOnly} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATION_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {k('minutes', { n: m })}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bt-step">{k('step')}</Label>
          <select id="bt-step" className={selectClass} value={step} disabled={readOnly} onChange={(e) => setStep(Number(e.target.value))}>
            {STEP_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {k('every', { n: m })}
              </option>
            ))}
          </select>
        </div>
        {!readOnly && (
          <Button onClick={() => void save()} disabled={saving || !changed}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Save className="size-4" aria-hidden />}
            {t('business.common.save')}
          </Button>
        )}
      </CardContent>

      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{k('help.title')}</DialogTitle>
            <DialogDescription>{k('help.intro')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-5 text-sm">
            <section className="space-y-1.5">
              <h3 className="font-semibold text-foreground">{k('help.durationTitle')}</h3>
              <p className="text-muted-foreground">{k('help.durationBody')}</p>
              <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{k('help.durationTip')}</p>
            </section>
            <section className="space-y-1.5">
              <h3 className="font-semibold text-foreground">{k('help.stepTitle')}</h3>
              <p className="text-muted-foreground">{k('help.stepBody')}</p>
              <ul className="space-y-1 text-xs">
                {STEP_OPTIONS.map((m) => (
                  <li key={m} className="flex gap-2">
                    <span className="w-24 shrink-0 font-medium text-foreground">{k('every', { n: m })}</span>
                    <span className="text-muted-foreground">{k(`help.grid${m}`)}</span>
                  </li>
                ))}
              </ul>
            </section>
            <section className="space-y-1.5">
              <h3 className="font-semibold text-foreground">{k('help.exampleTitle')}</h3>
              <p className="text-muted-foreground">{k('help.exampleIntro')}</p>
              <div className="overflow-hidden rounded-lg border border-border text-xs">
                <div className="grid grid-cols-2 border-b border-border bg-muted/50 font-medium text-foreground">
                  <span className="p-2">{k('every', { n: 30 })}</span>
                  <span className="border-l border-border p-2">{k('every', { n: 15 })}</span>
                </div>
                <div className="grid grid-cols-2 text-muted-foreground">
                  <span className="p-2">{k('help.example30')}</span>
                  <span className="border-l border-border p-2">{k('help.example15')}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{k('help.exampleTip')}</p>
            </section>
            <section className="space-y-1.5">
              <h3 className="font-semibold text-foreground">{k('help.calendarTitle')}</h3>
              <p className="text-muted-foreground">{k('help.calendarBody')}</p>
            </section>
            <p className="text-xs text-muted-foreground">{k('help.existing')}</p>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
