'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SLA_MAX, SLA_MIN, USD_RATE_MAX } from '@/lib/reports/settings';

export function ReportSettingsDialog({
  open,
  onOpenChange,
  slaMinutes,
  usdRate,
  currency,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  slaMinutes: number;
  usdRate: number | null;
  currency: string;
  onSaved: () => void;
}) {
  const t = useT();
  const [sla, setSla] = useState(String(slaMinutes));
  const [rate, setRate] = useState(usdRate !== null ? String(usdRate) : '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSla(String(slaMinutes));
    setRate(usdRate !== null ? String(usdRate) : '');
  }, [open, slaMinutes, usdRate]);

  const slaNum = Number(sla);
  const rateNum = Number(rate.replace(',', '.'));
  const slaOk = Number.isInteger(slaNum) && slaNum >= SLA_MIN && slaNum <= SLA_MAX;
  const rateOk = rate.trim() === '' || (Number.isFinite(rateNum) && rateNum > 0 && rateNum <= USD_RATE_MAX);

  const save = async () => {
    if (!slaOk || !rateOk) return;
    setSaving(true);
    try {
      const res = await fetch('/api/reports/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sla_minutes: slaNum, usd_rate: rate.trim() === '' ? null : rateNum }),
      });
      if (!res.ok) throw new Error();
      toast.success(t('reports.settings.saved'));
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error(t('reports.errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('reports.settings.title')}</DialogTitle>
          <DialogDescription>{t('reports.settings.description')}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rpt-sla">{t('reports.settings.sla')}</Label>
            <Input
              id="rpt-sla"
              type="number"
              inputMode="numeric"
              min={SLA_MIN}
              max={SLA_MAX}
              step={1}
              value={sla}
              onChange={(e) => setSla(e.target.value)}
              aria-invalid={!slaOk}
              aria-describedby="rpt-sla-hint"
            />
            <p id="rpt-sla-hint" className="text-xs text-muted-foreground">
              {t('reports.settings.slaHint', { min: SLA_MIN, max: SLA_MAX })}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rpt-rate">{t('reports.settings.usdRate', { currency })}</Label>
            <Input
              id="rpt-rate"
              inputMode="decimal"
              value={rate}
              onChange={(e) => setRate(e.target.value)}
              aria-invalid={!rateOk}
              aria-describedby="rpt-rate-hint"
              placeholder={currency === 'PEN' ? '3.75' : ''}
            />
            <p id="rpt-rate-hint" className="text-xs text-muted-foreground">
              {t('reports.settings.usdRateHint', { currency })}
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('reports.settings.cancel')}
            </Button>
            <Button type="submit" disabled={saving || !slaOk || !rateOk}>
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {t('reports.settings.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
