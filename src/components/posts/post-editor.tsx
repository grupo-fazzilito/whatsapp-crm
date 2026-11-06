'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ArrowLeft, ImagePlus, Loader2, Package, Play, Sparkles, X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { uploadFile } from '@/lib/storage/client';
import { FORMATS, MAX_CAPTION, postIssues, TARGETS, type PostFormat, type PostMedia, type Target } from '@/lib/social/model';
import type { PostView } from '@/lib/social/server';
import { errorText, TargetIcon } from './posts-manager';

interface ProductOption {
  id: string;
  name: string;
  images: string[];
}

/** 'YYYY-MM-DDTHH:MM' in the device's time zone (for <input type="datetime-local">). */
function localInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

const absolute = (u: string) => (/^https?:\/\//.test(u) ? u : `${window.location.origin}${u.startsWith('/') ? '' : '/'}${u}`);

export function PostEditor({ post, connected, onClose, onSaved }: { post: PostView | null; connected: Set<string>; onClose: () => void; onSaved: (p: PostView) => void }) {
  const t = useT();
  const [format, setFormat] = useState<PostFormat>(post?.format ?? 'post');
  const [media, setMedia] = useState<PostMedia[]>(post?.media ?? []);
  const [targets, setTargets] = useState<Target[]>(post?.targets ?? (['facebook', 'instagram'] as Target[]).filter((x) => connected.has(x)));
  const [caption, setCaption] = useState(post?.caption ?? '');
  const [link, setLink] = useState(post?.link_url ?? '');
  const [product, setProduct] = useState<{ id: string; name: string } | null>(post?.product_id ? { id: post.product_id, name: post.product_name ?? '' } : null);
  const [when, setWhen] = useState<'now' | 'schedule'>(post?.scheduled_at && new Date(post.scheduled_at).getTime() > Date.now() ? 'schedule' : 'now');
  const [at, setAt] = useState(localInput(post?.scheduled_at && new Date(post.scheduled_at).getTime() > Date.now() ? new Date(post.scheduled_at) : new Date(Date.now() + 3_600_000)));
  const [uploading, setUploading] = useState(0);
  const [saving, setSaving] = useState<'draft' | 'go' | null>(null);
  const [picking, setPicking] = useState(false);
  const [products, setProducts] = useState<ProductOption[] | null>(null);
  const [query, setQuery] = useState('');
  const [aiOpen, setAiOpen] = useState(false);
  const [idea, setIdea] = useState('');
  const [writing, setWriting] = useState(false);
  const [statusReady, setStatusReady] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);
  const pending = post?.status === 'pending_approval';

  useEffect(() => {
    void fetch('/api/social/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { settings: { status_phones: string[] } } | null) => setStatusReady(!!b?.settings.status_phones.length));
  }, []);

  useEffect(() => {
    if (!picking) return;
    const id = setTimeout(() => {
      void fetch(`/api/catalog/products?status=active&q=${encodeURIComponent(query)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : { products: [] }))
        .then((b: { products: ProductOption[] }) => setProducts(b.products.filter((p) => p.images?.length)));
    }, 250);
    return () => clearTimeout(id);
  }, [picking, query]);

  const scheduledIso = when === 'schedule' && at ? new Date(at).toISOString() : null;
  const issues = useMemo(
    () => postIssues({ format, caption: caption.trim(), media, targets, scheduled_at: scheduledIso, draft: false }),
    [format, caption, media, targets, scheduledIso],
  );

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = [...files].slice(0, 10 - media.length);
    for (const f of list) {
      if (!/^(image|video)\//.test(f.type)) {
        toast.error(t('posts.errors.mediaOnly'));
        continue;
      }
      if (f.size > 100 * 1024 * 1024) {
        toast.error(t('posts.errors.tooLarge'));
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const out = await uploadFile('social', f, { folder: 'posts' });
        setMedia((m) => [...m, { url: out.url, type: f.type.startsWith('video/') ? 'video' : 'image' }]);
      } catch {
        toast.error(t('posts.errors.upload'));
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (fileRef.current) fileRef.current.value = '';
  };

  const pickProduct = (p: ProductOption) => {
    setProduct({ id: p.id, name: p.name });
    setMedia(p.images.slice(0, format === 'post' ? 10 : 1).map((u) => ({ url: absolute(u), type: 'image' })));
    setPicking(false);
  };

  const toggleTarget = (x: Target) => setTargets((ts) => (ts.includes(x) ? ts.filter((y) => y !== x) : [...ts, x]));

  const writeAi = async () => {
    if (!product && !idea.trim()) {
      toast.error(t('posts.editor.aiNeedsInput'));
      return;
    }
    setWriting(true);
    const res = await fetch('/api/social/caption', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ format, targets, product_id: product?.id ?? null, idea }),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setWriting(false);
    if (!res?.ok) {
      toast.error(errorText(t, body));
      return;
    }
    setCaption((body as { caption: string }).caption);
    setAiOpen(false);
    toast.success(t('posts.toasts.captionReady'));
  };

  const save = async (draft: boolean) => {
    setSaving(draft ? 'draft' : 'go');
    const payload = { format, caption: caption.trim(), media, targets, product_id: product?.id ?? null, link_url: link.trim() || null, scheduled_at: scheduledIso, draft };
    const res = await fetch(post ? `/api/social/posts/${post.id}` : '/api/social/posts', {
      method: post ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    const body = await res?.json().catch(() => ({}));
    setSaving(null);
    if (!res?.ok) {
      toast.error(errorText(t, body));
      return;
    }
    const saved = (body as { post: PostView }).post;
    toast.success(draft ? t('posts.toasts.saved') : scheduledIso ? t('posts.toasts.scheduled') : t('posts.toasts.publishing'));
    onSaved(saved);
  };

  const move = (i: number) => setMedia((m) => [m[i], ...m.filter((_, j) => j !== i)]);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{post ? t('posts.editor.titleEdit') : t('posts.editor.titleNew')}</DialogTitle>
          <DialogDescription className="sr-only">{t('posts.description')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* Format */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('posts.editor.format')}</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup">
              {FORMATS.map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={format === f}
                  onClick={() => {
                    setFormat(f);
                    if (f !== 'post') setMedia((m) => (f === 'reel' ? m.filter((x) => x.type === 'video') : m).slice(0, 1));
                  }}
                  className={`rounded-lg border px-2 py-2 text-sm font-medium transition-colors ${format === f ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-muted'}`}
                >
                  {t(`posts.format.${f}`)}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">{t(`posts.formatHint.${format}`)}</p>
          </fieldset>

          {/* Media */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">{t('posts.editor.media')}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setPicking((v) => !v)}>
                  <Package className="size-4" aria-hidden /> {t('posts.editor.fromProduct')}
                </Button>
                <Button type="button" size="sm" variant="outline" disabled={uploading > 0 || media.length >= (format === 'post' ? 10 : 1)} onClick={() => fileRef.current?.click()}>
                  {uploading > 0 ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                  {uploading > 0 ? t('posts.editor.uploading') : t('posts.editor.upload')}
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  accept={format === 'reel' ? 'video/mp4,video/quicktime' : 'image/jpeg,image/png,image/webp,video/mp4,video/quicktime'}
                  multiple={format === 'post'}
                  onChange={(e) => void onFiles(e.target.files)}
                />
              </div>
            </div>

            {picking && (
              <div className="space-y-2 rounded-lg border border-border p-2">
                <Input autoFocus placeholder={t('posts.editor.productSearch')} aria-label={t('posts.editor.productSearch')} value={query} onChange={(e) => setQuery(e.target.value)} />
                {!products ? (
                  <Loader2 className="mx-auto size-4 animate-spin text-muted-foreground" aria-hidden />
                ) : products.length === 0 ? (
                  <p className="px-1 text-xs text-muted-foreground">{t('posts.editor.noProducts')}</p>
                ) : (
                  <ul className="max-h-56 space-y-1 overflow-y-auto">
                    {products.map((p) => (
                      <li key={p.id}>
                        <button type="button" onClick={() => pickProduct(p)} className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm hover:bg-muted">
                          {/* eslint-disable-next-line @next/next/no-img-element -- catalog photo */}
                          <img src={p.images[0]} alt="" className="size-9 rounded object-cover" />
                          <span className="truncate">{p.name}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {product && (
              <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {t('posts.editor.product', { name: product.name })}
                <button type="button" className="underline underline-offset-2" onClick={() => setProduct(null)}>
                  {t('posts.editor.removeProduct')}
                </button>
              </p>
            )}

            {media.length > 0 && (
              <ul className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {media.map((m, i) => (
                  <li key={`${m.url}-${i}`} className="group relative aspect-square overflow-hidden rounded-lg bg-muted">
                    {m.type === 'video' ? (
                      <>
                        <video src={m.url} className="size-full object-cover" muted preload="metadata" />
                        <Play className="absolute inset-0 m-auto size-6 text-white drop-shadow" aria-hidden />
                      </>
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element -- user media
                      <img src={m.url} alt="" className="size-full object-cover" />
                    )}
                    <button
                      type="button"
                      aria-label={t('posts.editor.removeMedia')}
                      onClick={() => setMedia((ms) => ms.filter((_, j) => j !== i))}
                      className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                    >
                      <X className="size-3.5" aria-hidden />
                    </button>
                    {i > 0 && (
                      <button
                        type="button"
                        aria-label={t('posts.editor.moveFirst')}
                        title={t('posts.editor.moveFirst')}
                        onClick={() => move(i)}
                        className="absolute bottom-1 left-1 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
                      >
                        <ArrowLeft className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t('posts.editor.mediaHint')}</p>
          </div>

          {/* Targets */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('posts.editor.targets')}</legend>
            <div className="flex flex-wrap gap-2">
              {TARGETS.map((x) => {
                const available = x === 'whatsapp_status' ? statusReady : connected.has(x);
                return (
                  <label
                    key={x}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${targets.includes(x) ? 'border-primary bg-primary/10' : 'border-border'} ${available ? '' : 'opacity-60'}`}
                  >
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={targets.includes(x)} onChange={() => toggleTarget(x)} />
                    <TargetIcon target={x} className="size-4" />
                    <span>{t(`posts.target.${x}`)}</span>
                    {!available && <span className="text-xs text-muted-foreground">({x === 'whatsapp_status' ? t('posts.editor.statusNoPhones') : t('posts.editor.notConnected')})</span>}
                  </label>
                );
              })}
            </div>
            {targets.includes('whatsapp_status') && <p className="text-xs text-muted-foreground">{t('posts.editor.statusNote')}</p>}
          </fieldset>

          {/* Caption */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="post-caption">{t('posts.editor.caption')}</Label>
              <Button type="button" size="sm" variant="outline" onClick={() => setAiOpen((v) => !v)} aria-expanded={aiOpen}>
                <Sparkles className="size-4" aria-hidden /> {t('posts.editor.ai')}
              </Button>
            </div>
            {aiOpen && (
              <div className="space-y-2 rounded-lg border border-primary/30 bg-primary/5 p-3">
                <Label htmlFor="post-idea" className="text-xs">{t('posts.editor.aiIdea')}</Label>
                <Textarea id="post-idea" rows={2} maxLength={600} placeholder={t('posts.editor.aiIdeaPlaceholder')} value={idea} onChange={(e) => setIdea(e.target.value)} />
                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" size="sm" disabled={writing} onClick={() => void writeAi()}>
                    {writing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Sparkles className="size-4" aria-hidden />} {t('posts.editor.aiWrite')}
                  </Button>
                  <span className="text-xs text-muted-foreground">{t('posts.editor.aiCost')}</span>
                </div>
              </div>
            )}
            <Textarea id="post-caption" rows={6} value={caption} maxLength={MAX_CAPTION + 200} placeholder={t('posts.editor.captionPlaceholder')} onChange={(e) => setCaption(e.target.value)} />
            <p className={`text-right text-xs ${caption.length > MAX_CAPTION ? 'text-red-600' : 'text-muted-foreground'}`}>{t('posts.editor.chars', { n: caption.length, max: MAX_CAPTION })}</p>
          </div>

          {/* Link */}
          {format !== 'story' && (
            <div className="space-y-1.5">
              <Label htmlFor="post-link">{t('posts.editor.link')}</Label>
              <Input id="post-link" type="url" inputMode="url" placeholder="https://" value={link} onChange={(e) => setLink(e.target.value)} />
              <p className="text-xs text-muted-foreground">{t('posts.editor.linkHint')}</p>
            </div>
          )}

          {/* When */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t('posts.editor.when')}</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input type="radio" name="post-when" className="size-4 accent-[var(--primary)]" checked={when === 'now'} onChange={() => setWhen('now')} /> {t('posts.editor.now')}
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="post-when" className="size-4 accent-[var(--primary)]" checked={when === 'schedule'} onChange={() => setWhen('schedule')} /> {t('posts.editor.schedule')}
              </label>
            </div>
            {when === 'schedule' && (
              <div className="space-y-1">
                <Input type="datetime-local" aria-label={t('posts.editor.dateTime')} value={at} min={localInput(new Date())} onChange={(e) => setAt(e.target.value)} className="w-full sm:w-64" />
                <p className="text-xs text-muted-foreground">{t('posts.editor.timeNote')}</p>
              </div>
            )}
          </fieldset>

          {issues.length > 0 && (
            <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-300" aria-live="polite">
              {issues.map((i) => (
                <li key={i}>• {t(`posts.issues.${i}`)}</li>
              ))}
            </ul>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" disabled={!!saving || uploading > 0} onClick={() => void save(true)}>
            {saving === 'draft' && <Loader2 className="size-4 animate-spin" aria-hidden />} {pending ? t('posts.editor.saveApproval') : t('posts.editor.saveDraft')}
          </Button>
          <Button type="button" disabled={!!saving || uploading > 0 || issues.length > 0} onClick={() => void save(false)}>
            {saving === 'go' && <Loader2 className="size-4 animate-spin" aria-hidden />} {when === 'schedule' ? t('posts.editor.scheduleBtn') : t('posts.editor.publishNow')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
