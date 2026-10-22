'use client';

import { useT } from '@/i18n/client';
import { cn } from '@/lib/utils';
import { optionsOf, type CustomField } from '@/lib/crm/custom-fields';

const base =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

/** Editor for one custom field value, by field type (value always travels as text). */
export function CustomFieldInput({
  field,
  value,
  onChange,
  id,
  className,
}: {
  field: CustomField;
  value: string;
  onChange: (value: string) => void;
  id: string;
  className?: string;
}) {
  const t = useT();
  switch (field.field_type) {
    case 'number':
      return <input id={id} type="number" inputMode="decimal" className={cn(base, className)} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'date':
      return <input id={id} type="date" className={cn(base, className)} value={value} onChange={(e) => onChange(e.target.value)} />;
    case 'boolean':
    case 'select': {
      const options = field.field_type === 'boolean' ? ['true', 'false'] : optionsOf(field);
      return (
        <select id={id} className={cn(base, className)} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{t('crm.customFields.choose')}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {field.field_type === 'boolean' ? (o === 'true' ? t('crm.customFields.yes') : t('crm.customFields.no')) : o}
            </option>
          ))}
        </select>
      );
    }
    default:
      return <input id={id} type="text" maxLength={5000} className={cn(base, className)} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
}
