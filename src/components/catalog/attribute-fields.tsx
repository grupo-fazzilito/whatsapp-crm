'use client';

import { useI18n, useT } from '@/i18n/client';
import type { AttributeField } from '@/lib/industries';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { selectClass } from '@/components/business/shared';

export type RawAttributes = Record<string, string | string[] | boolean>;

interface Props {
  fields: AttributeField[];
  values: RawAttributes;
  errors: Record<string, string>;
  readOnly: boolean;
  onChange: (key: string, value: string | string[] | boolean) => void;
}

/** Inputs for the industry's product attributes (products.attributes). */
export function AttributeFields({ fields, values, errors, readOnly, onChange }: Props) {
  const t = useT();
  const { locale } = useI18n();
  if (fields.length === 0) return null;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => {
        const id = `attr-${f.key}`;
        const err = errors[f.key];
        const errId = err ? `${id}-err` : undefined;
        const label = (
          <Label htmlFor={id}>
            {f.label[locale]}
            {f.unit && <span className="text-muted-foreground"> ({f.unit})</span>}
            {f.required && <span className="text-destructive" aria-hidden> *</span>}
          </Label>
        );
        const raw = values[f.key];
        let control: React.ReactNode;
        switch (f.type) {
          case 'boolean':
            return (
              <div key={f.key} className="flex items-center justify-between gap-3 rounded-lg border border-border p-3">
                <Label htmlFor={id}>{f.label[locale]}</Label>
                <Switch id={id} checked={raw === true} disabled={readOnly} onCheckedChange={(v) => onChange(f.key, v)} />
              </div>
            );
          case 'select':
            control = (
              <select
                id={id}
                className={cn(selectClass, err && 'border-destructive')}
                value={typeof raw === 'string' ? raw : ''}
                disabled={readOnly}
                aria-invalid={!!err}
                aria-describedby={errId}
                onChange={(e) => onChange(f.key, e.target.value)}
              >
                <option value="">{t('catalog.editor.choose')}</option>
                {f.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label[locale]}
                  </option>
                ))}
              </select>
            );
            break;
          case 'multiselect': {
            const list = Array.isArray(raw) ? raw : [];
            control = (
              <div
                id={id}
                role="group"
                aria-label={f.label[locale]}
                aria-describedby={errId}
                className={cn('flex flex-wrap gap-1.5 rounded-md border border-input p-2', err && 'border-destructive')}
              >
                {f.options?.map((o) => {
                  const on = list.includes(o.value);
                  return (
                    <button
                      key={o.value}
                      type="button"
                      aria-pressed={on}
                      disabled={readOnly}
                      onClick={() => onChange(f.key, on ? list.filter((x) => x !== o.value) : [...list, o.value])}
                      className={cn(
                        'rounded-full border px-2.5 py-0.5 text-xs transition-colors disabled:cursor-not-allowed',
                        on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted',
                      )}
                    >
                      {o.label[locale]}
                    </button>
                  );
                })}
              </div>
            );
            break;
          }
          case 'textarea':
            control = (
              <Textarea
                id={id}
                rows={3}
                maxLength={4000}
                value={typeof raw === 'string' ? raw : ''}
                disabled={readOnly}
                aria-invalid={!!err}
                aria-describedby={errId}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            );
            break;
          default:
            control = (
              <Input
                id={id}
                type={f.type === 'number' ? 'number' : 'text'}
                step={f.type === 'number' ? 'any' : undefined}
                maxLength={f.type === 'number' ? undefined : 300}
                value={typeof raw === 'string' ? raw : ''}
                disabled={readOnly}
                aria-invalid={!!err}
                aria-describedby={errId}
                onChange={(e) => onChange(f.key, e.target.value)}
              />
            );
        }
        return (
          <div key={f.key} className={cn('grid content-start gap-1.5', (f.type === 'textarea' || f.type === 'multiselect') && 'sm:col-span-2')}>
            {label}
            {control}
            {err && (
              <p id={errId} className="text-xs text-destructive">
                {t(`catalog.attrError.${err}`)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
