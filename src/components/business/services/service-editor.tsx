'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { invalidateAi, trimOrNull, type Service } from '../shared';

interface Props {
  service: Service | null;
  categories: string[];
  readOnly: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function ServiceEditor({ service, categories, readOnly, onClose, onSaved }: Props) {
  const t = useT();
  const { workspace, label } = useWorkspace();
  const [draft, setDraft] = useState({
    name: service?.name ?? '',
    description: service?.description ?? '',
    category: service?.category ?? '',
    price: service?.price != null ? String(service.price) : '',
    price_is_from: service?.price_is_from ?? false,
    duration_minutes: String(service?.duration_minutes ?? 30),
    is_active: service?.is_active ?? true,
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
      updated_at: new Date().toISOString(),
    };
    const db = createClient();
    const { error } = service
      ? await db.from('services').update(row).eq('id', service.id)
      : await db.from('services').insert({ ...row, workspace_id: workspace.id });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await invalidateAi();
    toast.success(t('business.common.saved'));
    onSaved();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
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
