'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Building2,
  GraduationCap,
  Loader2,
  Save,
  Scissors,
  ShoppingBag,
  Sparkles,
  Stethoscope,
  Store,
  UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';
import { useI18n, useT } from '@/i18n/client';
import { useWorkspace } from '@/hooks/use-workspace';
import { createClient } from '@/lib/supabase/client';
import { PRESETS, getPreset, type IndustryLabels, type ModuleKey } from '@/lib/industries';
import type { Workspace, WorkspaceSettings } from '@/lib/workspace/types';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { invalidateAi } from '../shared';
import { ProductAttributesEditor } from './product-attributes-editor';

const MODULE_KEYS: ModuleKey[] = ['bookings', 'staff', 'services', 'products', 'orders', 'triage'];
const LABEL_KEYS = [
  'staff',
  'staffPlural',
  'service',
  'servicePlural',
  'booking',
  'bookingPlural',
  'customer',
  'customerPlural',
] as const satisfies readonly (keyof IndustryLabels)[];
type LabelKey = (typeof LABEL_KEYS)[number];
type Loc = 'es' | 'en';

const PRESET_ICONS: Record<string, LucideIcon> = {
  Stethoscope,
  Scissors,
  Sparkles,
  GraduationCap,
  UtensilsCrossed,
  ShoppingBag,
  Building2,
  Store,
};

function PresetIcon({ name, className }: { name: string; className?: string }) {
  const Icon = PRESET_ICONS[name] ?? Store;
  return <Icon className={className} />;
}

export function IndustryForm({ workspace, readOnly }: { workspace: Workspace; readOnly: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const { refresh } = useWorkspace();
  const settings: WorkspaceSettings = useMemo(() => workspace.settings ?? {}, [workspace.settings]);
  const [industry, setIndustry] = useState(workspace.industry || 'generic');
  const preset = getPreset(industry);
  const [moduleOverrides, setModuleOverrides] = useState<Record<string, boolean>>(() => ({ ...(settings.modules ?? {}) }));
  const [labels, setLabels] = useState<Record<Loc, Partial<Record<LabelKey, string>>>>(() => ({
    es: { ...((settings.labels?.es as Record<string, string>) ?? {}) },
    en: { ...((settings.labels?.en as Record<string, string>) ?? {}) },
  }));
  const [labelLocale, setLabelLocale] = useState<Loc>(locale);
  const [capacity, setCapacity] = useState<number>(Math.max(1, Number(settings.booking_capacity ?? 1) || 1));
  const [saving, setSaving] = useState(false);

  const moduleOn = (k: ModuleKey) => (typeof moduleOverrides[k] === 'boolean' ? moduleOverrides[k] : preset.modules[k]);
  const showCapacity = moduleOn('bookings') && !preset.bookingNeedsStaff;
  const presetLabel = (k: keyof IndustryLabels, loc: Loc = locale) => preset.labels[k][loc];
  const effLabel = (k: LabelKey) => labels[locale][k]?.trim() || presetLabel(k);

  const moduleName = (k: ModuleKey) => {
    switch (k) {
      case 'staff':
        return effLabel('staffPlural');
      case 'services':
        return effLabel('servicePlural');
      case 'bookings':
        return effLabel('bookingPlural');
      case 'products':
        return presetLabel('productPlural');
      default:
        return t(`business.setup.industry.module.${k}`);
    }
  };

  const save = async () => {
    if (readOnly) return;
    setSaving(true);
    // Keep only switches that differ from the chosen preset, so a later
    // preset change starts from that preset's own defaults.
    const modules: Record<string, boolean> = {};
    for (const k of MODULE_KEYS) {
      const v = moduleOn(k);
      if (v !== preset.modules[k]) modules[k] = v;
    }
    const cleanLabels: Record<string, Record<string, string>> = {};
    for (const loc of ['es', 'en'] as Loc[]) {
      const entries = Object.entries(labels[loc]).filter(([, v]) => typeof v === 'string' && v.trim());
      if (entries.length) cleanLabels[loc] = Object.fromEntries(entries.map(([k, v]) => [k, (v as string).trim().slice(0, 40)]));
    }
    const nextSettings: WorkspaceSettings = { ...settings, modules, labels: cleanLabels };
    if (showCapacity) nextSettings.booking_capacity = Math.min(500, Math.max(1, Math.round(capacity) || 1));

    const { error } = await createClient()
      .from('workspaces')
      .update({ industry, settings: nextSettings })
      .eq('id', workspace.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await invalidateAi();
    await refresh();
    toast.success(t('business.common.saved'));
  };

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>{t('business.setup.industry.title')}</CardTitle>
          <CardDescription>{t('business.setup.industry.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div role="radiogroup" aria-label={t('business.setup.industry.title')} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {PRESETS.map((p) => {
              const active = p.id === industry;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={readOnly}
                  onClick={() => setIndustry(p.id)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed',
                    active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex size-9 shrink-0 items-center justify-center rounded-md',
                      active ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
                    )}
                  >
                    <PresetIcon name={p.icon} className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{p.name[locale]}</span>
                    <span className="block text-xs text-muted-foreground">{p.description[locale]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('business.setup.industry.modulesTitle')}</CardTitle>
          <CardDescription>{t('business.setup.industry.modulesDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {MODULE_KEYS.filter((k) => k !== 'triage' || industry === 'clinic' || moduleOn('triage')).map((k) => (
            <label key={k} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{moduleName(k)}</span>
                <span className="block text-xs text-muted-foreground">{t(`business.setup.industry.moduleHint.${k}`)}</span>
              </span>
              <Switch
                checked={moduleOn(k)}
                disabled={readOnly}
                aria-label={moduleName(k)}
                onCheckedChange={(v) => setModuleOverrides((m) => ({ ...m, [k]: v }))}
              />
            </label>
          ))}
          {showCapacity && (
            <div className="grid gap-1.5 rounded-lg border border-border p-3 sm:col-span-2">
              <Label htmlFor="bi-capacity">{t('business.setup.industry.capacity', { bookings: effLabel('bookingPlural').toLowerCase() })}</Label>
              <Input
                id="bi-capacity"
                type="number"
                min={1}
                max={500}
                className="max-w-32"
                value={capacity}
                disabled={readOnly}
                onChange={(e) => setCapacity(Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">{t('business.setup.industry.capacityHint')}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('business.setup.industry.labelsTitle')}</CardTitle>
          <CardDescription>{t('business.setup.industry.labelsDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="inline-flex w-fit rounded-lg bg-muted p-[3px]" role="tablist">
            {(['es', 'en'] as Loc[]).map((loc) => (
              <button
                key={loc}
                type="button"
                role="tab"
                aria-selected={labelLocale === loc}
                onClick={() => setLabelLocale(loc)}
                className={cn(
                  'rounded-md px-3 py-1 text-sm font-medium',
                  labelLocale === loc ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground',
                )}
              >
                {loc === 'es' ? 'Español' : 'English'}
              </button>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {LABEL_KEYS.map((k) => (
              <div key={`${labelLocale}-${k}`} className="grid gap-1.5">
                <Label htmlFor={`bl-${labelLocale}-${k}`}>{t(`business.setup.industry.labelKey.${k}`)}</Label>
                <Input
                  id={`bl-${labelLocale}-${k}`}
                  maxLength={40}
                  value={labels[labelLocale][k] ?? ''}
                  placeholder={presetLabel(k, labelLocale)}
                  disabled={readOnly}
                  onChange={(e) => setLabels((l) => ({ ...l, [labelLocale]: { ...l[labelLocale], [k]: e.target.value } }))}
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {!readOnly && (
        <div className="flex justify-end">
          <Button type="button" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t('business.common.save')}
          </Button>
        </div>
      )}

      {moduleOn('products') && <ProductAttributesEditor workspace={workspace} industry={industry} readOnly={readOnly} />}
    </div>
  );
}
