'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import { uploadFile } from '@/lib/storage/client';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { api } from '../api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { trimOrNull, type Service } from '../shared';

interface Props {
  service: Service | null;
  categories: string[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ServiceEditor({ service, categories, readOnly, onClose, onSaved }: Props) {
  const t = useT();
  const { workspace, label, modules } = useWorkspace();
  const [uploading, setUploading] = useState(false);
  const [draft, setDraft] = useState({
    name: service?.name ?? '',
    description: service?.description ?? '',
    category: service?.category ?? '',
    price: service?.price != null ? String(service.price) : '',
    price_is_from: service?.price_is_from ?? false,
    duration_minutes: String(service?.duration_minutes ?? 30),
    is_active: service?.is_active ?? true,
    image_url: service?.image_url ?? '',
    show_in_store: service?.show_in_store ?? true,
    store_booking: service?.store_booking ?? ('schedule' as 'schedule' | 'later'),
  });
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const noun = label('service');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (readOnly || !workspace) return;
    if (!draft.name.trim()) {
      toast.error(t('business.services.nameRequired'));
      return;
    }
    const duration = Math.round(Number(draft.duration_minutes));
    if (!(duration >= 5 && duration <= 1440)) {
      toast.error(t('business.services.invalidDuration'));
      return;
    }
    setSaving(true);
    const row = {
      name: draft.name.trim(),
      description: trimOrNull(draft.description),
      category: trimOrNull(draft.category),
      price: Number(draft.price) > 0 ? Number(draft.price) : 0,
      price_is_from: draft.price_is_from,
      duration_minutes: duration,
      is_active: draft.is_active,
      ...(modules.orders
        ? { image_url: draft.image_url || null, show_in_store: draft.show_in_store, store_booking: draft.store_booking }
        : {}),
    };
    try {
      // The server drops the AI's cached business context.
      if (service) await api(`/api/business/services/${service.id}`, { method: 'PATCH', body: row });
      else await api('/api/business/services', { method: 'POST', body: row });
    } catch (err) {
      setSaving(false);
      toast.error(err instanceof Error ? err.message : String(err));
      return;
    }
    setSaving(false);
    toast.success(t('business.common.saved'));
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>
              {service
                ? readOnly
                  ? service.name
                  : t('business.common.editItem', { item: service.name })
                : t('business.common.newItem', { item: noun.toLowerCase() })}
            </DialogTitle>
            <DialogDescription>{t('business.services.editorDescription')}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-1.5">
            <Label htmlFor="sv-name">{t('business.services.field.name')}</Label>
            <Input id="sv-name" required maxLength={160} value={draft.name} disabled={readOnly} onChange={(e) => set('name', e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sv-desc">{t('business.services.field.description')}</Label>
            <Textarea
              id="sv-desc"
              rows={3}
              maxLength={1000}
              value={draft.description}
              disabled={readOnly}
              onChange={(e) => set('description', e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sv-cat">{t('business.services.field.category')}</Label>
              <Input
                id="sv-cat"
                list="sv-categories"
                maxLength={80}
                value={draft.category}
                disabled={readOnly}
                onChange={(e) => set('category', e.target.value)}
              />
              <datalist id="sv-categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sv-dur">{t('business.services.field.duration')}</Label>
              <Input
                id="sv-dur"
                type="number"
                min={5}
                max={1440}
                step={5}
                value={draft.duration_minutes}
                disabled={readOnly}
                onChange={(e) => set('duration_minutes', e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="sv-price">
                {t('business.services.field.price')} ({workspace?.currency})
              </Label>
              <Input
                id="sv-price"
                type="number"
                min={0}
                step="any"
                value={draft.price}
                disabled={readOnly}
                onChange={(e) => set('price', e.target.value)}
              />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm text-foreground">
              <Switch checked={draft.price_is_from} disabled={readOnly} onCheckedChange={(v) => set('price_is_from', v)} />
              {t('business.services.field.priceFrom')}
            </label>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
            <span className="text-sm font-medium text-foreground">{t('business.services.field.active')}</span>
            <Switch checked={draft.is_active} disabled={readOnly} onCheckedChange={(v) => set('is_active', v)} />
          </label>

          {modules.orders && (
            <fieldset className="grid gap-3 rounded-lg border border-border p-3">
              <legend className="px-1 text-sm font-semibold text-foreground">{t('business.services.store.title')}</legend>
              <label className="flex items-center justify-between gap-3">
                <span className="text-sm text-foreground">{t('business.services.store.show')}</span>
                <Switch checked={draft.show_in_store} disabled={readOnly} onCheckedChange={(v) => set('show_in_store', v)} />
              </label>
              {draft.show_in_store && (
                <>
                  <div className="grid gap-2" role="radiogroup" aria-label={t('business.services.store.bookingLabel')}>
                    <span className="text-sm font-medium text-foreground">{t('business.services.store.bookingLabel')}</span>
                    {(['schedule', 'later'] as const).map((k) => (
                      <label key={k} className={`flex cursor-pointer items-start gap-2 rounded-md border p-2.5 text-sm ${draft.store_booking === k ? 'border-primary bg-primary/5' : 'border-border'}`}>
                        <input type="radio" name="sv-booking" className="mt-0.5" checked={draft.store_booking === k} disabled={readOnly} onChange={() => set('store_booking', k)} />
                        <span>
                          <span className="block font-medium text-foreground">{t(`business.services.store.${k}`)}</span>
                          <span className="block text-xs text-muted-foreground">{t(`business.services.store.${k}Hint`)}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <div className="grid gap-1.5">
                    <span className="text-sm font-medium text-foreground">{t('business.services.store.image')}</span>
                    {draft.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element -- uploaded photo preview
                      <img src={draft.image_url} alt="" className="aspect-video w-full max-w-xs rounded-md border border-border object-cover" />
                    )}
                    <div className="flex flex-wrap gap-2">
                      <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent ${readOnly || uploading ? 'pointer-events-none opacity-60' : ''}`}>
                        {uploading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ImagePlus className="size-4" aria-hidden />}
                        {t('business.services.store.upload')}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="sr-only"
                          disabled={readOnly || uploading}
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            if (!file) return;
                            setUploading(true);
                            try {
                              const { url } = await uploadFile('catalog', file, { folder: 'services' });
                              set('image_url', url);
                            } catch (err) {
                              toast.error(err instanceof Error ? err.message : String(err));
                            } finally {
                              setUploading(false);
                              e.target.value = '';
                            }
                          }}
                        />
                      </label>
                      {draft.image_url && !readOnly && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => set('image_url', '')}>
                          <Trash2 className="size-4" aria-hidden /> {t('business.services.store.removeImage')}
                        </Button>
                      )}
                    </div>
                  </div>
                </>
              )}
            </fieldset>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {readOnly ? t('business.common.close') : t('business.common.cancel')}
            </Button>
            {!readOnly && (
              <Button type="submit" disabled={saving}>
                {saving && <Loader2 className="size-4 animate-spin" />}
                {t('business.common.save')}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
