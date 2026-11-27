'use client';

import { useId, useState } from 'react';
import { toast } from 'sonner';
import { DatabaseBackup, Download, Loader2 } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { DATASETS, type Dataset } from '@/lib/backup/datasets-list';

/** Settings → Backup: a ZIP with the chosen datasets of the business (admins). */
export function BackupCard() {
  const { t, locale } = useI18n();
  const id = useId();
  const [chosen, setChosen] = useState<Set<Dataset>>(() => new Set(DATASETS));
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const withConversations = chosen.has('conversations');
  const badRange = withConversations && !!from && !!to && from > to;
  const none = chosen.size === 0;
  const toggle = (d: Dataset, on: boolean) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (on) next.add(d);
      else next.delete(d);
      return next;
    });

  const download = async () => {
    setBusy(true);
    try {
      const q = new URLSearchParams({ datasets: DATASETS.filter((d) => chosen.has(d)).join(','), lang: locale === 'en' ? 'en' : 'es' });
      if (withConversations) {
        if (from) q.set('from', from);
        if (to) q.set('to', to);
        if (internal) q.set('internal', '1');
      }
      const res = await fetch(`/api/backup?${q}`);
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        const key = `backup.errors.${body.error ?? 'generic'}`;
        const msg = t(key);
        toast.error(msg === key ? t('backup.errors.generic') : msg);
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'respaldo-whasalia.zip';
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(t('backup.done'));
    } catch {
      toast.error(t('backup.errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <DatabaseBackup className="size-5 text-primary" aria-hidden /> {t('backup.title')}
        </CardTitle>
        <CardDescription>{t('backup.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{t('backup.datasetsLabel')}</legend>
          <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 sm:max-w-md">
            {DATASETS.map((d) => (
              <label key={d} htmlFor={`${id}-ds-${d}`} className="flex items-center gap-2 text-sm">
                <input
                  id={`${id}-ds-${d}`}
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={chosen.has(d)}
                  onChange={(e) => toggle(d, e.target.checked)}
                />
                {t(`backup.datasets.${d}`)}
              </label>
            ))}
          </div>
          {none ? (
            <p className="text-xs text-destructive" role="alert">
              {t('backup.noneSelected')}
            </p>
          ) : null}
        </fieldset>
        {withConversations ? (
          <fieldset className="space-y-3 rounded-md border p-3 sm:max-w-md">
            <legend className="px-1 text-sm font-medium">{t('backup.conversationsOptions')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-from`}>{t('backup.from')}</Label>
                <Input id={`${id}-from`} type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${id}-to`}>{t('backup.to')}</Label>
                <Input id={`${id}-to`} type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </div>
            </div>
            <p className={badRange ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'} role={badRange ? 'alert' : undefined}>
              {badRange ? t('backup.errors.invalid_dates') : t('backup.rangeHelp')}
            </p>
            <div className="flex items-center gap-2">
              <Switch id={`${id}-internal`} checked={internal} onCheckedChange={setInternal} />
              <Label htmlFor={`${id}-internal`} className="font-normal">
                {t('backup.internal')}
              </Label>
            </div>
          </fieldset>
        ) : null}
        <Button onClick={() => void download()} disabled={busy || badRange || none}>
          {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Download className="size-4" aria-hidden />}
          {busy ? t('backup.downloading') : t('backup.download')}
        </Button>
        {withConversations ? <p className="text-xs text-muted-foreground">{t('backup.media')}</p> : null}
      </CardContent>
    </Card>
  );
}
