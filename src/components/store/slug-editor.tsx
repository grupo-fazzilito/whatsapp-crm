'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, Pencil } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { normalizeSlug, SLUG_MAX } from '@/lib/workspace/slug';

type Check = { slug: string; problem: string | null; available: boolean };

/** Edits the business's public address (whasalia.com/tienda/<slug>); old links keep redirecting. */
export function SlugEditor({ url, readOnly, onSaved }: { url: string; readOnly: boolean; onSaved: (url: string) => void }) {
  const t = useT();
  const { refresh } = useWorkspace();
  const current = decodeURIComponent(url.slice(url.lastIndexOf('/') + 1));
  const prefix = url.slice(0, url.lastIndexOf('/') + 1).replace(/^https?:\/\//, '');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [check, setCheck] = useState<Check | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A cleaner address from the business name ("barberia-leo" instead of "barberia-leo-a1b2c3").
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/store/slug', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { current: string; suggestion: string; suggestion_available: boolean } | null) => {
        if (!cancelled && d?.suggestion_available && d.suggestion !== d.current) setSuggestion(d.suggestion);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Availability, a moment after typing stops.
  useEffect(() => {
    if (!open || value === current) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- nothing to check
      setCheck(null);
      return;
    }
    let cancelled = false;
    const id = setTimeout(() => {
      fetch(`/api/store/slug?slug=${encodeURIComponent(value)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: Check | null) => !cancelled && setCheck(d))
        .catch(() => {});
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [open, value, current]);

  const problem = check && check.slug === value ? (check.problem ?? (check.available ? null : 'taken')) : null;
  const canSave = !readOnly && !saving && value !== current && check?.slug === value && !problem;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    setError(null);
    const res = await fetch('/api/store/slug', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: value }) }).catch(() => null);
    const body = (await res?.json().catch(() => ({}))) as { url?: string; error?: string };
    setSaving(false);
    if (res?.ok && body.url) {
      onSaved(body.url);
      setOpen(false);
      setSuggestion(null);
      void refresh();
      toast.success(t('store.address.saved'));
      return;
    }
    setError(t(`store.address.errors.${body.error && ['short', 'long', 'format', 'reserved', 'taken'].includes(body.error) ? body.error : 'failed'}`));
  };

  if (!open) {
    return readOnly ? null : (
      <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => { setValue(current); setError(null); setOpen(true); }}>
        <Pencil className="size-4" aria-hidden /> {t('store.address.change')}
      </Button>
    );
  }

  const message = error ?? (problem ? t(`store.address.errors.${problem}`) : null);
  return (
    <form onSubmit={save} className="space-y-3 rounded-lg border border-border p-4">
      <div className="grid gap-1.5">
        <Label htmlFor="store-slug">{t('store.address.title')}</Label>
        <div className="flex min-w-0 items-stretch">
          <span className="hidden shrink-0 items-center rounded-l-md border border-r-0 border-input bg-muted px-3 text-sm text-muted-foreground sm:inline-flex">{prefix}</span>
          <Input
            id="store-slug"
            className="min-w-0 sm:rounded-l-none"
            autoComplete="off"
            spellCheck={false}
            maxLength={SLUG_MAX + 10}
            value={value}
            aria-invalid={!!message || undefined}
            aria-describedby="store-slug-help"
            onChange={(e) => {
              setError(null);
              // Typing a space or an accent turns into the address form right away.
              setValue(normalizeSlug(e.target.value.replace(/\s/g, '-')) + (/[\s-]$/.test(e.target.value) ? '-' : ''));
            }}
          />
        </div>
        <p id="store-slug-help" className="text-xs text-muted-foreground" aria-live="polite">
          <span className="sm:hidden">{prefix}{value || '…'} · </span>
          {message ? (
            <span className="text-destructive">{message}</span>
          ) : value === current ? (
            t('store.address.current')
          ) : check?.slug === value && check.available ? (
            <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" aria-hidden /> {t('store.address.available')}</span>
          ) : value.length ? (
            t('store.address.checking')
          ) : (
            t('store.address.hint')
          )}
        </p>
      </div>
      {suggestion && suggestion !== value && (
        <Button type="button" variant="outline" size="sm" onClick={() => setValue(suggestion)}>
          {t('store.address.useSuggestion', { slug: suggestion })}
        </Button>
      )}
      <p className="text-xs text-muted-foreground">{t('store.address.oldLinks')}</p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!canSave}>
          {saving && <Loader2 className="size-4 animate-spin" aria-hidden />} {t('store.address.save')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>{t('store.address.cancel')}</Button>
      </div>
    </form>
  );
}
