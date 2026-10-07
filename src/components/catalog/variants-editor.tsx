'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useT } from '@/i18n/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { Variant } from './types';

export interface VariantDraft {
  /** Unset for variants not saved yet. */
  id?: string;
  /** Stable React key. */
  key: string;
  name: string;
  options: { k: string; v: string }[];
  sku: string;
  price: string;
  stock: string;
  is_active: boolean;
}

let seq = 0;
const nextKey = () => `v${Date.now()}-${seq++}`;

export function toVariantDraft(v: Variant): VariantDraft {
  return {
    id: v.id,
    key: v.id,
    name: v.name,
    options: Object.entries(v.options ?? {}).map(([k, val]) => ({ k, v: String(val) })),
    sku: v.sku ?? '',
    price: v.price != null ? String(v.price) : '',
    stock: v.stock != null ? String(v.stock) : '',
    is_active: v.is_active,
  };
}

export function newVariantDraft(): VariantDraft {
  return { key: nextKey(), name: '', options: [{ k: '', v: '' }], sku: '', price: '', stock: '', is_active: true };
}

interface Props {
  variants: VariantDraft[];
  readOnly: boolean;
  currency: string;
  trackStock: boolean;
  onChange: (variants: VariantDraft[]) => void;
}

export function VariantsEditor({ variants, readOnly, currency, trackStock, onChange }: Props) {
  const t = useT();
  const update = (key: string, patch: Partial<VariantDraft>) =>
    onChange(variants.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  return (
    <div className="grid gap-3">
      {variants.length === 0 && <p className="text-sm text-muted-foreground">{t('catalog.variants.empty')}</p>}
      {variants.map((v, idx) => {
        const p = `var-${v.key}`;
        return (
          <fieldset key={v.key} className="grid gap-3 rounded-lg border border-border p-3">
            <legend className="sr-only">{t('catalog.variants.legend', { n: idx + 1 })}</legend>
            <div className="flex items-end gap-2">
              <div className="grid flex-1 gap-1">
                <label htmlFor={`${p}-name`} className="text-xs font-medium text-muted-foreground">
                  {t('catalog.variants.name')}
                </label>
                <Input
                  id={`${p}-name`}
                  maxLength={120}
                  placeholder={t('catalog.variants.namePlaceholder')}
                  value={v.name}
                  disabled={readOnly}
                  onChange={(e) => update(v.key, { name: e.target.value })}
                />
              </div>
              <label className="flex h-9 items-center gap-2 text-xs text-muted-foreground">
                <Switch checked={v.is_active} disabled={readOnly} onCheckedChange={(on) => update(v.key, { is_active: on })} />
                {t('catalog.field.active')}
              </label>
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="mb-1 text-destructive"
                  aria-label={t('catalog.variants.remove', { n: idx + 1 })}
                  onClick={() => onChange(variants.filter((x) => x.key !== v.key))}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              )}
            </div>

            <div className="grid gap-1">
              <span className="text-xs font-medium text-muted-foreground">{t('catalog.variants.options')}</span>
              {v.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <Input
                    aria-label={t('catalog.variants.optionKey')}
                    placeholder={t('catalog.variants.optionKeyPlaceholder')}
                    maxLength={40}
                    value={o.k}
                    disabled={readOnly}
                    onChange={(e) => update(v.key, { options: v.options.map((x, i) => (i === oi ? { ...x, k: e.target.value } : x)) })}
                  />
                  <Input
                    aria-label={t('catalog.variants.optionValue')}
                    placeholder={t('catalog.variants.optionValuePlaceholder')}
                    maxLength={80}
                    value={o.v}
                    disabled={readOnly}
                    onChange={(e) => update(v.key, { options: v.options.map((x, i) => (i === oi ? { ...x, v: e.target.value } : x)) })}
                  />
                  {!readOnly && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('catalog.variants.removeOption')}
                      onClick={() => update(v.key, { options: v.options.filter((_, i) => i !== oi) })}
                    >
                      <X className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              {!readOnly && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => update(v.key, { options: [...v.options, { k: '', v: '' }] })}
                >
                  <Plus className="size-3.5" />
                  {t('catalog.variants.addOption')}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div className="grid gap-1">
                <label htmlFor={`${p}-sku`} className="text-xs font-medium text-muted-foreground">
                  SKU
                </label>
                <Input id={`${p}-sku`} maxLength={80} value={v.sku} disabled={readOnly} onChange={(e) => update(v.key, { sku: e.target.value })} />
              </div>
              <div className="grid gap-1">
                <label htmlFor={`${p}-price`} className="text-xs font-medium text-muted-foreground">
                  {t('catalog.variants.price', { currency })}
                </label>
                <Input
                  id={`${p}-price`}
                  type="number"
                  min={0}
                  step="any"
                  placeholder={t('catalog.variants.pricePlaceholder')}
                  value={v.price}
                  disabled={readOnly}
                  onChange={(e) => update(v.key, { price: e.target.value })}
                />
              </div>
              <div className="grid gap-1">
                <label htmlFor={`${p}-stock`} className="text-xs font-medium text-muted-foreground">
                  {t('catalog.field.stock')}
                </label>
                <Input
                  id={`${p}-stock`}
                  type="number"
                  min={0}
                  step={1}
                  value={v.stock}
                  disabled={readOnly || !trackStock}
                  placeholder={trackStock ? '' : '—'}
                  onChange={(e) => update(v.key, { stock: e.target.value })}
                />
              </div>
            </div>
          </fieldset>
        );
      })}
      {!readOnly && (
        <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => onChange([...variants, newVariantDraft()])}>
          <Plus className="size-3.5" />
          {t('catalog.variants.add')}
        </Button>
      )}
    </div>
  );
}
