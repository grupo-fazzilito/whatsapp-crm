'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, ImagePlus, Loader2, Send } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PageHeader } from '@/components/business/shared';
import { uploadFile } from '@/lib/storage/client';
import { CARD_LIMITS, cardIssues, type MessengerCard } from '@/lib/messenger-marketing/model';
import type { MessengerStatus } from '@/lib/messenger-marketing/server';

interface Tag {
  id: string;
  name: string;
  color: string;
}

function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Difusiones → new Messenger broadcast: a card to the subscribers (paid by the business's ad account). */
export function MessengerBroadcastForm() {
  const t = useT();
  const router = useRouter();
  const [status, setStatus] = useState<MessengerStatus | null>(null);
  const [tags, setTags] = useState<Tag[]>([]);
  const [name, setName] = useState('');
  const [card, setCard] = useState<MessengerCard>({ title: '', subtitle: '', image_url: '', button_text: '', button_url: '' });
  const [byTags, setByTags] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [count, setCount] = useState<{ ready: number; too_soon: number } | null>(null);
  const [budget, setBudget] = useState('');
  const [when, setWhen] = useState<'now' | 'schedule'>('now');
  const [at, setAt] = useState(localInput(new Date(Date.now() + 3_600_000)));
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch('/api/messenger-marketing', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then(setStatus);
    void fetch('/api/broadcasts/setup?include=tags', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { tags: [] }))
      .then((b: { tags?: Tag[] }) => setTags(b.tags ?? []));
  }, []);

  const audienceKey = byTags ? tagIds.join(',') : '';
  useEffect(() => {
    if (byTags && !tagIds.length) {
       
      setCount({ ready: 0, too_soon: 0 });
      return;
    }
    const id = setTimeout(() => {
      void fetch('/api/messenger-marketing/audience', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tag_ids: byTags ? tagIds : [] }) })
        .then((r) => (r.ok ? r.json() : null))
        .then(setCount);
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- audienceKey covers tagIds
  }, [byTags, audienceKey]);

  const issues = useMemo(() => cardIssues(card), [card]);

  const upload = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f || !f.type.startsWith('image/')) return;
    setUploading(true);
    try {
      const out = await uploadFile('social', f, { folder: 'messenger' });
      setCard((c) => ({ ...c, image_url: out.url }));
    } catch {
      toast.error(t('posts.errors.upload'));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    setSaving(true);
    const res = await fetch('/api/messenger-marketing/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, card, tag_ids: byTags ? tagIds : [], budget: budget || null, scheduled_at: when === 'schedule' ? new Date(at).toISOString() : null }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setSaving(false);
    if (!res?.ok) {
      const code = body?.error as string | undefined;
      toast.error(code && ['empty', 'not_connected', 'invalid_budget'].includes(code) ? t(`mm.form.errors.${code}`) : t('mm.form.errors.generic'));
      return;
    }
    toast.success(t('mm.form.sent', { n: body.recipients }));
    router.push('/broadcasts');
  };

  const field = (key: keyof MessengerCard, label: string, max: number, placeholder = '', type = 'text') => (
    <div className="space-y-1">
      <Label htmlFor={`mmc-${key}`}>{label}</Label>
      <Input id={`mmc-${key}`} type={type} maxLength={max} placeholder={placeholder} value={card[key]} onChange={(e) => setCard({ ...card, [key]: e.target.value })} />
    </div>
  );

  const ready = !!name.trim() && !issues.length && (count?.ready ?? 0) > 0 && !!status?.connection;

  return (
    <div className="space-y-6">
      <Link href="/broadcasts" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> {t('mm.form.back')}
      </Link>
      <PageHeader title={t('mm.form.title')} description={t('mm.intro')} />
      {status && !status.connection && <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">{t('mm.form.errors.not_connected')}</p>}

      <div className="grid gap-6 lg:grid-cols-[1fr_18rem]">
        <div className="space-y-5">
          <div className="space-y-1">
            <Label htmlFor="mmc-name">{t('mm.form.name')}</Label>
            <Input id="mmc-name" maxLength={120} placeholder={t('mm.form.namePlaceholder')} value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <fieldset className="space-y-3 rounded-xl border border-border bg-card p-4">
            <legend className="px-1 text-sm font-semibold">{t('mm.form.card')}</legend>
            <p className="text-xs text-muted-foreground">{t('mm.form.cardHint')}</p>
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('mm.form.image')}</p>
              <Button type="button" size="sm" variant="outline" disabled={uploading} onClick={() => fileRef.current?.click()}>
                {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                {uploading ? t('mm.form.uploading') : t('mm.form.upload')}
              </Button>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => void upload(e.target.files)} />
            </div>
            {field('title', t('mm.form.cardTitle'), CARD_LIMITS.title)}
            {field('subtitle', t('mm.form.subtitle'), CARD_LIMITS.subtitle)}
            <div className="grid gap-3 sm:grid-cols-2">
              {field('button_text', t('mm.form.buttonText'), CARD_LIMITS.button, t('mm.form.buttonTextPlaceholder'))}
              {field('button_url', t('mm.form.buttonUrl'), 1000, 'https://', 'url')}
            </div>
          </fieldset>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('mm.form.audience')}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="mm-aud" className="size-4 accent-[var(--primary)]" checked={!byTags} onChange={() => setByTags(false)} /> {t('mm.form.allSubscribers')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mm-aud" className="size-4 accent-[var(--primary)]" checked={byTags} onChange={() => setByTags(true)} /> {t('mm.form.byTags')}
              </label>
            </div>
            {byTags &&
              (tags.length ? (
                <div className="flex flex-wrap gap-2">
                  {tags.map((tag) => (
                    <label key={tag.id} className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm ${tagIds.includes(tag.id) ? 'border-primary bg-primary/10' : 'border-border'}`}>
                      <input type="checkbox" className="size-3.5" checked={tagIds.includes(tag.id)} onChange={() => setTagIds((ids) => (ids.includes(tag.id) ? ids.filter((x) => x !== tag.id) : [...ids, tag.id]))} />
                      <span className="size-2 rounded-full" style={{ background: tag.color }} aria-hidden />
                      {tag.name}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t('mm.form.noTags')}</p>
              ))}
            {count && (
              <p className="text-sm" aria-live="polite">
                {t('mm.form.count', { n: count.ready })}
                {count.too_soon > 0 && <span className="block text-xs text-muted-foreground">{t('mm.form.tooSoon', { n: count.too_soon })}</span>}
              </p>
            )}
          </fieldset>

          <div className="space-y-1">
            <Label htmlFor="mmc-budget">{t('mm.form.budget', { currency: status?.connection?.currency ?? '' })}</Label>
            <Input id="mmc-budget" type="number" min="1" step="0.01" inputMode="decimal" className="w-40" value={budget} onChange={(e) => setBudget(e.target.value)} />
            <p className="text-xs text-muted-foreground">{t('mm.form.budgetHint')}</p>
          </div>

          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold">{t('mm.form.when')}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="mm-when" className="size-4 accent-[var(--primary)]" checked={when === 'now'} onChange={() => setWhen('now')} /> {t('mm.form.now')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="mm-when" className="size-4 accent-[var(--primary)]" checked={when === 'schedule'} onChange={() => setWhen('schedule')} /> {t('mm.form.schedule')}
              </label>
            </div>
            {when === 'schedule' && <Input type="datetime-local" aria-label={t('mm.form.schedule')} className="w-full sm:w-64" min={localInput(new Date())} value={at} onChange={(e) => setAt(e.target.value)} />}
          </fieldset>

          {issues.length > 0 && (
            <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300">
              {issues.map((i) => (
                <li key={i}>• {t(`mm.form.issues.${i}`)}</li>
              ))}
            </ul>
          )}
          <Button type="button" disabled={!ready || saving} onClick={() => void submit()}>
            {saving ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />} {when === 'schedule' ? t('mm.form.scheduleBtn') : t('mm.form.send')}
          </Button>
        </div>

        <aside aria-label={t('mm.form.preview')} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('mm.form.preview')}</p>
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="aspect-[1.91/1] bg-muted">
              {card.image_url && (
                // eslint-disable-next-line @next/next/no-img-element -- uploaded image
                <img src={card.image_url} alt="" className="size-full object-cover" />
              )}
            </div>
            <div className="space-y-0.5 p-3">
              <p className="text-sm font-semibold break-words">{card.title || '—'}</p>
              {card.subtitle && <p className="text-xs text-muted-foreground break-words">{card.subtitle}</p>}
            </div>
            <div className="border-t border-border py-2 text-center text-sm font-medium text-primary">{card.button_text || '—'}</div>
          </div>
        </aside>
      </div>
    </div>
  );
}
